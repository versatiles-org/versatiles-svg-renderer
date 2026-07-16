import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { ensureCacheDir, readCache, writeCache } from './fetch-cache.js';

const MAPLIBRE_VERSION = '5.5.0';

const distDir = resolve(import.meta.dirname, '..', 'dist');
const pluginJs = readFileSync(resolve(distDir, 'maplibre-svg-export.js'), 'utf8');

console.log('Launching browser...');
const browser = await chromium.launch({
	args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

const page = await browser.newPage({
	viewport: { width: 800, height: 600 },
	deviceScaleFactor: 1,
});

// Cache external network requests (unpkg.com)
ensureCacheDir();
await page.route('https://unpkg.com/**', async (route) => {
	const url = route.request().url();
	const cached = readCache(url);
	if (cached) {
		await route.fulfill({
			status: cached.status,
			contentType: cached.contentType,
			body: Buffer.from(cached.body, 'base64'),
		});
		return;
	}
	const response = await route.fetch();
	const body = await response.body();
	writeCache(url, {
		status: response.status(),
		contentType: response.headers()['content-type'] ?? 'application/octet-stream',
		body: body.toString('base64'),
	});
	await route.fulfill({ response, body });
});

// Serve the plugin bundle via route interception
await page.route('**/svg-export-plugin.js', (route) => {
	void route.fulfill({
		status: 200,
		contentType: 'application/javascript',
		body: pluginJs,
	});
});

// Serve the HTML page via route interception so we have a real origin
await page.route('**/index.html', (route) => {
	void route.fulfill({
		status: 200,
		contentType: 'text/html',
		body: `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js"></script>
<style>* { margin: 0; padding: 0; } #map { width: 800px; height: 600px; }</style>
</head><body><div id="map"></div></body></html>`,
	});
});

await page.goto('http://localhost/index.html');

// Wait for MapLibre GL to load
await page.waitForFunction(() => typeof (window as any).maplibregl !== 'undefined', {
	timeout: 15000,
});

console.log('MapLibre loaded, initializing map...');

// Initialize map with a simple style
await page.evaluate(
	({ center, zoom }: { center: [number, number]; zoom: number }) => {
		return new Promise<void>((resolve, reject) => {
			const map = new (window as any).maplibregl.Map({
				container: 'map',
				style: {
					version: 8,
					sources: {},
					layers: [
						{
							id: 'background',
							type: 'background',
							paint: { 'background-color': '#e0e0e0' },
						},
					],
				},
				center,
				zoom,
				interactive: false,
				fadeDuration: 0,
				attributionControl: false,
			});
			(window as any)._map = map;
			map.once('idle', () => resolve());
			setTimeout(() => reject(new Error('MapLibre idle timeout')), 30000);
		});
	},
	{ center: [13.4, 52.5] as [number, number], zoom: 10 },
);

console.log('Map initialized, loading plugin...');

// Add the control to the map using dynamic import of the served plugin
await page.evaluate(async () => {
	// @ts-expect-error dynamic import of served plugin
	const mod = await import('/svg-export-plugin.js');
	const control = new mod.SVGExportControl({ defaultWidth: 400, defaultHeight: 300 });
	(window as any)._map.addControl(control, 'top-right');
});

// Test 1: Button is visible
console.log('Test 1: Checking button visibility...');
const button = page.locator('.svg-export-btn');
await button.waitFor({ state: 'visible', timeout: 5000 });
console.log('  PASS: Export button is visible');

// Test 2: Click opens panel
console.log('Test 2: Opening panel...');
await button.click();
const panel = page.locator('.svg-export-panel');
await panel.waitFor({ state: 'visible', timeout: 5000 });
console.log('  PASS: Panel opened');

// Test 3: Inputs are present with correct defaults
console.log('Test 3: Checking inputs...');
const widthInput = page.locator('.input-width');
const heightInput = page.locator('.input-height');
await widthInput.waitFor({ state: 'visible', timeout: 2000 });

const widthVal = await widthInput.inputValue();
const heightVal = await heightInput.inputValue();

if (widthVal !== '400') throw new Error(`Expected width 400, got ${widthVal}`);
if (heightVal !== '300') throw new Error(`Expected height 300, got ${heightVal}`);
console.log('  PASS: Inputs have correct default values');

// Test 4: Preview renders SVG
console.log('Test 4: Waiting for preview...');
const iframe = panel.locator('.preview-container iframe');
await iframe.waitFor({ state: 'visible', timeout: 30000 });
console.log('  PASS: Preview iframe rendered');

// Test 5: Action buttons become enabled
console.log('Test 5: Checking action buttons...');
const downloadBtn = page.locator('.btn-download');
const openBtn = page.locator('.btn-open');
await expectEnabled(downloadBtn);
await expectEnabled(openBtn);
console.log('  PASS: Download and Open in Tab buttons are enabled');

// Test 6: Download triggers file download
console.log('Test 6: Testing SVG download...');
const [download] = await Promise.all([
	page.waitForEvent('download', { timeout: 10000 }),
	downloadBtn.click(),
]);
if (!download.suggestedFilename().endsWith('.svg')) {
	throw new Error(`Expected .svg filename, got ${download.suggestedFilename()}`);
}
console.log(`  PASS: Download triggered (${download.suggestedFilename()})`);

// Test 7: Open in Tab opens a new tab
console.log('Test 7: Testing Open in Tab...');
const [newPage] = await Promise.all([
	page.context().waitForEvent('page', { timeout: 10000 }),
	openBtn.click(),
]);
await newPage.waitForLoadState();
console.log('  PASS: SVG opened in new tab');
await newPage.close();

// Test 8: Close panel
console.log('Test 8: Closing panel...');
const closeBtn = page.locator('.panel-close');
await closeBtn.click();
await panel.waitFor({ state: 'detached', timeout: 5000 });
console.log('  PASS: Panel closed');

await browser.close();
console.log('\nAll MapLibre control tests passed!');

async function expectEnabled(
	locator: ReturnType<typeof page.locator>,
	timeout = 10000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const disabled = await locator.getAttribute('disabled');
		if (disabled === null) return;
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error('Element remained disabled after timeout');
}
