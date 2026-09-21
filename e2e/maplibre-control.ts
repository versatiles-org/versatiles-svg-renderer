/**
 * Drives `SVGExportControl` in a real browser, against both MapLibre GL JS versions the
 * plugin supports, and with both of its builds:
 *
 * | Scenario   | MapLibre GL JS                                    | Plugin build                           |
 * | ---------- | ------------------------------------------------- | -------------------------------------- |
 * | MapLibre 5 | 5.5.0, UMD from unpkg (cached)                     | ES module, via `import()`              |
 * | MapLibre 6 | the version in node_modules (ESM-only since v6)   | minified UMD, via `<script>` (global)  |
 *
 * The second scenario is how versatiles-frontend uses the plugin.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { ensureCacheDir, readCache, writeCache } from './fetch-cache.js';
import { installMapLibrePage } from './maplibre-page.js';

const MAPLIBRE_5_VERSION = '5.5.0';
const MAPLIBRE_6_VERSION = (
	JSON.parse(
		readFileSync(resolve(import.meta.dirname, '../node_modules/maplibre-gl/package.json'), 'utf8'),
	) as { version: string }
).version;

const distDir = resolve(import.meta.dirname, '..', 'packages', 'maplibre-svg-export', 'dist');
const pluginEsm = readFileSync(resolve(distDir, 'maplibre-svg-export.js'), 'utf8');
const pluginUmd = readFileSync(resolve(distDir, 'maplibre-svg-export.umd.min.js'), 'utf8');

const WIDTH = 800;
const HEIGHT = 600;

interface Scenario {
	name: string;
	/** The MapLibre GL JS version the page must report. */
	maplibreVersion: string;
	/** Opens a page with `window.maplibregl` available. */
	openPage(page: Page): Promise<void>;
	/** Makes `window.SVGExportControl` available, from the build under test. */
	loadPlugin(page: Page): Promise<void>;
}

const scenarios: Scenario[] = [
	{
		name: `MapLibre ${MAPLIBRE_5_VERSION} + ES module build`,
		maplibreVersion: MAPLIBRE_5_VERSION,
		async openPage(page) {
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

			// Serve the HTML page via route interception so we have a real origin
			await page.route('**/index.html', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'text/html',
					body: `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${MAPLIBRE_5_VERSION}/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_5_VERSION}/dist/maplibre-gl.js"></script>
<style>* { margin: 0; padding: 0; } #map { width: ${String(WIDTH)}px; height: ${String(HEIGHT)}px; }</style>
</head><body><div id="map"></div></body></html>`,
				}),
			);
			await page.goto('http://localhost/index.html');
			await page.waitForFunction(() => typeof (window as any).maplibregl !== 'undefined', {
				timeout: 15000,
			});
		},
		async loadPlugin(page) {
			await page.route('**/svg-export-plugin.js', (route) =>
				route.fulfill({ status: 200, contentType: 'application/javascript', body: pluginEsm }),
			);
			await page.evaluate(async () => {
				// @ts-expect-error dynamic import of served plugin
				const mod = await import('/svg-export-plugin.js');
				(window as any).SVGExportControl = mod.SVGExportControl;
			});
		},
	},
	{
		name: `MapLibre ${MAPLIBRE_6_VERSION} + minified UMD build`,
		maplibreVersion: MAPLIBRE_6_VERSION,
		async openPage(page) {
			await installMapLibrePage(page, { width: WIDTH, height: HEIGHT });
		},
		async loadPlugin(page) {
			// A classic script, as on a page with <script src="…umd.min.js">: it sets the global.
			await page.addScriptTag({ content: pluginUmd });
			await page.evaluate(() => {
				(window as any).SVGExportControl = (window as any).VersaTilesSVG.SVGExportControl;
			});
		},
	},
];

console.log('Launching browser...');
const browser = await chromium.launch({
	args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
try {
	for (const scenario of scenarios) {
		console.log(`\n=== ${scenario.name}`);
		await runScenario(browser, scenario);
	}
} finally {
	await browser.close();
}
console.log(`\nAll MapLibre control tests passed (${String(scenarios.length)} scenarios)!`);

async function runScenario(browser: Browser, scenario: Scenario): Promise<void> {
	const context = await browser.newContext({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 1,
	});
	const page = await context.newPage();
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));

	await scenario.openPage(page);
	const version = await page.evaluate(() => (window as any).maplibregl.getVersion() as string);
	if (version !== scenario.maplibreVersion) {
		throw new Error(`Expected MapLibre GL JS ${scenario.maplibreVersion}, the page has ${version}`);
	}
	console.log(`MapLibre GL JS ${version} loaded, initializing map...`);

	// Initialize an interactive map with a simple style, so the test can check that the
	// panel disables and restores the map's interaction handlers.
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
	await scenario.loadPlugin(page);
	await page.evaluate(() => {
		const control = new (window as any).SVGExportControl({ defaultWidth: 400, defaultHeight: 300 });
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

	// Test 3: The map stops responding to panning and zooming while the panel is open
	console.log('Test 3: Checking map interactions...');
	await expectInteractions(page, false);
	console.log('  PASS: Map interactions are disabled');

	// Test 4: Inputs are present with correct defaults
	console.log('Test 4: Checking inputs...');
	const widthInput = page.locator('.input-width');
	const heightInput = page.locator('.input-height');
	await widthInput.waitFor({ state: 'visible', timeout: 2000 });

	const widthVal = await widthInput.inputValue();
	const heightVal = await heightInput.inputValue();

	if (widthVal !== '400') throw new Error(`Expected width 400, got ${widthVal}`);
	if (heightVal !== '300') throw new Error(`Expected height 300, got ${heightVal}`);
	console.log('  PASS: Inputs have correct default values');

	// Test 5: Preview renders SVG
	console.log('Test 5: Waiting for preview...');
	const iframe = panel.locator('.preview-container iframe');
	await iframe.waitFor({ state: 'visible', timeout: 30000 });
	const srcdoc = (await iframe.getAttribute('srcdoc')) ?? '';
	if (!srcdoc.includes('<svg')) throw new Error('The preview contains no SVG');
	console.log('  PASS: Preview iframe rendered');

	// Test 6: Action buttons become enabled
	console.log('Test 6: Checking action buttons...');
	const downloadBtn = page.locator('.btn-download');
	const openBtn = page.locator('.btn-open');
	await expectEnabled(downloadBtn);
	await expectEnabled(openBtn);
	console.log('  PASS: Download and Open in Tab buttons are enabled');

	// Test 7: Download triggers file download
	console.log('Test 7: Testing SVG download...');
	const [download] = await Promise.all([
		page.waitForEvent('download', { timeout: 10000 }),
		downloadBtn.click(),
	]);
	if (!download.suggestedFilename().endsWith('.svg')) {
		throw new Error(`Expected .svg filename, got ${download.suggestedFilename()}`);
	}
	console.log(`  PASS: Download triggered (${download.suggestedFilename()})`);

	// Test 8: Open in Tab opens a new tab
	console.log('Test 8: Testing Open in Tab...');
	const [newPage] = await Promise.all([
		context.waitForEvent('page', { timeout: 10000 }),
		openBtn.click(),
	]);
	await newPage.waitForLoadState();
	console.log('  PASS: SVG opened in new tab');
	await newPage.close();

	// Test 9: Close panel, which gives the map its interactions back
	console.log('Test 9: Closing panel...');
	const closeBtn = page.locator('.panel-close');
	await closeBtn.click();
	await panel.waitFor({ state: 'detached', timeout: 5000 });
	await expectInteractions(page, true);
	console.log('  PASS: Panel closed, map interactions restored');

	// Test 10: No uncaught errors on the page
	if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join('; ')}`);
	console.log('  PASS: No page errors');

	await context.close();
}

/** Asserts that every interaction handler the control toggles is enabled (or disabled). */
async function expectInteractions(page: Page, enabled: boolean): Promise<void> {
	const states = await page.evaluate(() => {
		const map = (window as any)._map;
		const names = [
			'boxZoom',
			'doubleClickZoom',
			'dragPan',
			'dragRotate',
			'keyboard',
			'scrollZoom',
			'touchPitch',
			'touchZoomRotate',
		];
		return Object.fromEntries(names.map((name) => [name, map[name].isEnabled() as boolean]));
	});
	const wrong = Object.entries(states).filter(([, state]) => state !== enabled);
	if (wrong.length > 0) {
		throw new Error(
			`Expected map interactions to be ${enabled ? 'enabled' : 'disabled'}, but these are not: ${wrong.map(([name]) => name).join(', ')}`,
		);
	}
}

async function expectEnabled(locator: Locator, timeout = 10000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const disabled = await locator.getAttribute('disabled');
		if (disabled === null) return;
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error('Element remained disabled after timeout');
}
