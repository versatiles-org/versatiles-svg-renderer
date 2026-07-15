import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { styles } from '@versatiles/style';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { renderToSVG } from '../src/index.js';
import type { Page } from 'playwright';
import { ensureCacheDir, installFetchCache, readCache, writeCache } from './fetch-cache.js';
import { Feature } from 'geojson';

installFetchCache();

const WIDTH = 800;
const HEIGHT = 600;

interface Region {
	name: string;
	lon: number;
	lat: number;
	zoom: number;
	type: 'vector' | 'satellite' | 'geojson';
}

const regions: Region[] = [
	{ name: 'berlin', lon: 13.357, lat: 52.515, zoom: 14.2, type: 'vector' },
	{ name: 'paris', lon: 2.295, lat: 48.858, zoom: 14.9, type: 'vector' },
	{ name: 'warsaw', lon: 21.013, lat: 52.249, zoom: 14.9, type: 'vector' },
	{ name: 'tokyo', lon: 139.692, lat: 35.69, zoom: 10, type: 'vector' },
	{ name: 'roma', lon: 12.489, lat: 41.89, zoom: 14.9, type: 'vector' },
	{ name: 'sao-paulo', lon: -46.635, lat: -23.548, zoom: 14, type: 'vector' },

	{ name: 'berlin', lon: 13.376, lat: 52.518, zoom: 15, type: 'satellite' },

	{ name: 'berlin', lon: 13.388, lat: 52.517, zoom: 14, type: 'geojson' },
];

const outputDir = resolve(import.meta.dirname, 'output');
const maplibreDir = resolve(outputDir, 'maplibre');
const svgDir = resolve(outputDir, 'svg');
const diffDir = resolve(outputDir, 'diff');

for (const dir of [outputDir, maplibreDir, svgDir, diffDir]) {
	mkdirSync(dir, { recursive: true });
}

const styleCache = new Map<string, StyleSpecification>();
async function getStyle(type: Region['type']): Promise<StyleSpecification> {
	let style = styleCache.get(type);
	if (!style) {
		switch (type) {
			case 'vector':
				style = styles.colorful({ hideLabels: true });
				break;
			case 'satellite':
				style = await styles.satellite({ overlay: false });
				break;
			case 'geojson':
				style = styles.colorful({ hideLabels: true });
				style.sources['geojson-overlay'] = {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: [
							{
								type: 'Polygon',
								coordinates: [
									[
										[13.38, 52.52],
										[13.39, 52.52],
										[13.39, 52.514],
										[13.38, 52.514],
										[13.38, 52.52],
									],
									[
										[13.383, 52.518],
										[13.387, 52.518],
										[13.387, 52.516],
										[13.383, 52.516],
										[13.383, 52.518],
									],
								],
							},
							{
								type: 'LineString',
								coordinates: [
									[13.391, 52.515],
									[13.392, 52.519],
									[13.393, 52.516],
									[13.394, 52.519],
									[13.395, 52.515],
								],
							},
							...(
								[
									[13.399, 52.519],
									[13.398, 52.517],
									[13.397, 52.515],
								] as [number, number][]
							).map((coordinates) => ({
								type: 'Point',
								coordinates,
							})),
						].map(
							(geometry) =>
								({
									type: 'Feature',
									properties: {},
									geometry,
								}) as Feature,
						),
					},
				};
				// Isolated west->east line for validating line-offset direction and line-blur
				// against MapLibre (kept separate from the polygon so ring rewinding does not
				// affect the offset side).
				style.sources['geojson-lines'] = {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: {
							type: 'LineString',
							coordinates: [
								[13.382, 52.512],
								[13.392, 52.512],
							],
						},
					},
				};
				style.layers.push(
					{
						id: 'geojson-fill',
						type: 'fill',
						source: 'geojson-overlay',
						paint: {
							'fill-color': '#00ff00',
							'fill-opacity': 0.3,
						},
					},
					{
						id: 'geojson-line',
						type: 'line',
						source: 'geojson-overlay',
						paint: {
							'line-color': '#0000ff',
							'line-width': 4,
						},
					},
					{
						id: 'geojson-line-offset',
						type: 'line',
						source: 'geojson-lines',
						paint: {
							'line-color': '#ff8800',
							'line-width': 2,
							'line-offset': 6,
						},
					},
					{
						id: 'geojson-line-blur',
						type: 'line',
						source: 'geojson-lines',
						paint: {
							'line-color': '#00cccc',
							'line-width': 3,
							'line-offset': -6,
							'line-blur': 3,
						},
					},
					{
						id: 'geojson-circle',
						type: 'circle',
						source: 'geojson-overlay',
						paint: {
							'circle-radius': 8,
							'circle-color': '#cc0000',
							'circle-stroke-width': 2,
							'circle-stroke-color': '#ffffff',
						},
					},
				);
				break;
		}
		styleCache.set(type, style);
	}
	return style;
}

function regionId(region: Region): string {
	return `${region.name}-${region.type}`;
}

console.log('Launching browser...');
const browser = await chromium.launch({
	args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

// Cache browser network requests (unpkg.com, tile servers)
ensureCacheDir();
async function installPageCache(page: Page): Promise<void> {
	await page.route('**/*', async (route) => {
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
		try {
			const response = await route.fetch();
			const body = await response.body();
			// Only cache successful, non-empty responses. Caching errors or empty
			// bodies would poison the cache and defeat the render retry.
			if (response.ok() && body.length > 0) {
				writeCache(url, {
					status: response.status(),
					contentType: response.headers()['content-type'] ?? 'application/octet-stream',
					body: body.toString('base64'),
				});
			}
			await route.fulfill({ response, body });
		} catch {
			// Network failure (e.g. ECONNRESET): fail this request fast so the map
			// gives up quickly and the outer retry can restart, rather than hanging
			// until the idle timeout.
			await route.abort();
		}
	});
}

// Generate SVG screenshots
console.log('\n--- SVG Screenshots ---');
const svgSizes = new Map<string, number>();
for (const region of regions) {
	const id = regionId(region);
	const style = await getStyle(region.type);
	console.log(`  Rendering SVG: ${id}...`);
	const svg = await renderToSVG({
		width: WIDTH,
		height: HEIGHT,
		style,
		lon: region.lon,
		lat: region.lat,
		zoom: region.zoom,
	});

	svgSizes.set(id, Buffer.byteLength(svg, 'utf8'));
	writeFileSync(resolve(svgDir, `${id}.svg`), svg);

	const page = await browser.newPage({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 1,
	});
	await page.setContent(`<!DOCTYPE html>
<html><head><style>* { margin: 0; padding: 0; }</style></head>
<body>${svg}</body></html>`);
	await page.screenshot({ path: resolve(svgDir, `${id}.png`) });
	await page.close();
}

// Generate MapLibre screenshots
console.log('\n--- MapLibre Screenshots ---');
for (const region of regions) {
	const id = regionId(region);
	const style = await getStyle(region.type);
	console.log(`  Rendering MapLibre: ${id}...`);
	const page = await browser.newPage({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 1,
	});
	await installPageCache(page);

	await page.setContent(`<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl/dist/maplibre-gl.js"></script>
<style>* { margin: 0; padding: 0; } #map { width: ${WIDTH}px; height: ${HEIGHT}px; }</style>
</head><body><div id="map"></div></body></html>`);

	await page.waitForFunction(() => typeof (window as any).maplibregl !== 'undefined', {
		timeout: 15000,
	});

	// @ts-expect-error page.evaluate type instantiation too deep
	await page.evaluate(
		({ styleJson, center, zoom }: { styleJson: any; center: [number, number]; zoom: number }) => {
			return new Promise<void>((resolve, reject) => {
				const map = new (window as any).maplibregl.Map({
					container: 'map',
					style: styleJson,
					center,
					zoom,
					interactive: false,
					fadeDuration: 0,
					attributionControl: false,
					pixelRatio: 1,
				});
				map.once('idle', () => resolve());
				setTimeout(() => reject(new Error('MapLibre idle timeout')), 30000);
			});
		},
		{
			styleJson: style,
			center: [region.lon, region.lat] as [number, number],
			zoom: region.zoom,
		},
	);

	await page.screenshot({ path: resolve(maplibreDir, `${id}.png`) });
	await page.close();
}

await browser.close();

// Compare screenshots
console.log('\n--- Comparing ---');
interface Result {
	region: Region;
	id: string;
	diffPercent: number;
	svgSizeKB: number;
}

const results: Result[] = [];

for (const region of regions) {
	const id = regionId(region);
	const maplibreData = PNG.sync.read(readFileSync(resolve(maplibreDir, `${id}.png`)));
	const svgData = PNG.sync.read(readFileSync(resolve(svgDir, `${id}.png`)));
	const diff = new PNG({ width: WIDTH, height: HEIGHT });

	const mismatch = pixelmatch(maplibreData.data, svgData.data, diff.data, WIDTH, HEIGHT, {
		threshold: 0.1,
	});
	const totalPixels = WIDTH * HEIGHT;
	const diffPercent = (mismatch / totalPixels) * 100;

	writeFileSync(resolve(diffDir, `${id}.png`), PNG.sync.write(diff));
	console.log(`  ${id}: ${diffPercent.toFixed(2)}% different`);

	results.push({
		region,
		id,
		diffPercent,
		svgSizeKB: (svgSizes.get(id) ?? 0) / 1024,
	});
}

// Generate HTML report
console.log('\n--- Generating Report ---');
const rows = results
	.map((r) => {
		return `<tr>
	<td>
		<strong>${r.id}</strong><br>
		lon: ${r.region.lon}<br>
		lat: ${r.region.lat}<br>
		zoom: ${r.region.zoom}<br>
		type: ${r.region.type}<br>
		SVG size: ${r.svgSizeKB.toFixed(0)} KB<br>
		<span style="color:${r.diffPercent > 50 ? 'red' : r.diffPercent > 20 ? 'orange' : 'green'}">
			diff: ${r.diffPercent.toFixed(2)}%
		</span>
	</td>
	<td><a href="svg/${r.id}.svg"><img src="svg/${r.id}.png" width="${WIDTH / 2}" height="${HEIGHT / 2}"></a></td>
	<td><a href="maplibre/${r.id}.png"><img src="maplibre/${r.id}.png" width="${WIDTH / 2}" height="${HEIGHT / 2}"></a></td>
	<td><a href="diff/${r.id}.png"><img src="diff/${r.id}.png" width="${WIDTH / 2}" height="${HEIGHT / 2}"></a></td>
</tr>`;
	})
	.join('\n');

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>E2E Visual Comparison Report</title>
<style>
	body { font-family: sans-serif; margin: 20px; background: #f5f5f5; }
	h1 { margin-bottom: 20px; }
	table { border-collapse: collapse; }
	th, td { border: 1px solid #ccc; padding: 8px; vertical-align: top; background: white; }
	th { background: #eee; position: sticky; top: 0; }
	img { display: block; }
</style>
</head><body>
<h1>E2E Visual Comparison Report</h1>
<p>Generated: ${new Date().toISOString()}</p>
<table>
<tr><th>Region</th><th>SVG Renderer</th><th>MapLibre screenshot</th><th>Diff</th></tr>
${rows}
</table>
</body></html>`;

const reportPath = resolve(outputDir, 'report.html');
writeFileSync(reportPath, html);
console.log(`\nReport saved to: ${reportPath}`);
