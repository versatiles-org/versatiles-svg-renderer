import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { renderToSVG } from '../src/index.js';
import type { Page } from 'playwright';
import { ensureCacheDir, installFetchCache, readCache, writeCache } from './fetch-cache.js';
import { getStyle, regionId, regions, type Region } from './styles.js';

installFetchCache();

const WIDTH = 800;
const HEIGHT = 600;

const outputDir = resolve(import.meta.dirname, 'output');
const maplibreDir = resolve(outputDir, 'maplibre');
const svgDir = resolve(outputDir, 'svg');
const diffDir = resolve(outputDir, 'diff');

for (const dir of [outputDir, maplibreDir, svgDir, diffDir]) {
	mkdirSync(dir, { recursive: true });
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
		// Retry on a flaky upstream (ECONNRESET) so a cache miss still resolves and
		// the map can reach `idle`, instead of a single failure aborting the tile.
		for (let attempt = 0; attempt < 6; attempt++) {
			try {
				const response = await route.fetch();
				const body = await response.body();
				if (response.status() === 404) {
					await route.fulfill({ response, body });
					return;
				}
				if (!response.ok() || body.length === 0) continue;
				// Only cache successful, non-empty responses.
				writeCache(url, {
					status: response.status(),
					contentType: response.headers()['content-type'] ?? 'application/octet-stream',
					body: body.toString('base64'),
				});
				await route.fulfill({ response, body });
				return;
			} catch {
				await new Promise((r) => setTimeout(r, 300));
			}
		}
		await route.abort();
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

// Compare each region against MapLibre and against the committed diff baseline.
// The run fails on a missing screenshot, a diff above the region's maxDiff ceiling,
// or a degradation (diff risen beyond noise) vs the baseline. Surprising
// improvements are highlighted (green) but do not fail — re-bless with
// `UPDATE_BASELINE=1 npm run test:e2e:screenshots`.
console.log('\n--- Comparing ---');

const useColor = !process.env.NO_COLOR;
const paint = (code: number, s: string): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s: string): string => paint(31, s);
const green = (s: string): string => paint(32, s);
const dim = (s: string): string => paint(90, s);

const baselinePath = resolve(import.meta.dirname, 'diff-baseline.json');
const baseline: Record<string, number> = existsSync(baselinePath)
	? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>)
	: {};

// A change counts as degradation/improvement only if it clears both a 5% relative
// move and a 0.1% absolute floor (anything smaller is MapLibre AA/GPU render noise).
const REL_TOLERANCE = 0.05;
const ABS_FLOOR = 0.1;

// The hard ceiling is derived from the baseline rather than hand-maintained: a diff
// must stay under max(baseline * 1.5, baseline + 0.3%). It's the backstop above the
// (stricter) degradation check, and reproduces the old per-region maxDiff values.
const ceilingFor = (base: number): number => Math.max(base * 1.5, base + 0.3);

interface Result {
	region: Region;
	id: string;
	diffPercent: number;
	svgSizeKB: number;
}

const results: Result[] = [];
const updatedBaseline: Record<string, number> = {};
let failed = false;

for (const region of regions) {
	const id = regionId(region);
	const maplibrePath = resolve(maplibreDir, `${id}.png`);
	const svgPath = resolve(svgDir, `${id}.png`);
	if (!existsSync(maplibrePath) || !existsSync(svgPath)) {
		console.log(red(`  ${id}: MISSING screenshot — render failed`));
		failed = true;
		continue;
	}

	const maplibreData = PNG.sync.read(readFileSync(maplibrePath));
	const svgData = PNG.sync.read(readFileSync(svgPath));
	const diff = new PNG({ width: WIDTH, height: HEIGHT });
	const mismatch = pixelmatch(maplibreData.data, svgData.data, diff.data, WIDTH, HEIGHT);
	const diffPercent = (mismatch / (WIDTH * HEIGHT)) * 100;
	writeFileSync(resolve(diffDir, `${id}.png`), PNG.sync.write(diff));
	updatedBaseline[id] = Math.round(diffPercent * 100) / 100;

	const base = baseline[id];
	let color: (s: string) => string = (s) => s;
	let note = '';
	if (base === undefined) {
		note = dim(' (no baseline — bless with UPDATE_BASELINE=1)');
	} else {
		const ceiling = ceilingFor(base);
		const delta = diffPercent - base;
		const significant = Math.abs(delta) > Math.max(base * REL_TOLERANCE, ABS_FLOOR);
		if (diffPercent > ceiling) {
			color = red;
			note = red(` ✗ exceeds ceiling ${ceiling.toFixed(2)}%`);
			failed = true;
		} else if (significant && delta > 0) {
			color = red;
			note = red(` ▲ degradation (was ${base.toFixed(2)}%)`);
			failed = true;
		} else if (significant && delta < 0) {
			color = green;
			note = green(` ▼ improvement (was ${base.toFixed(2)}%) — update baseline`);
		}
	}
	console.log(`  ${color(`${id}: ${diffPercent.toFixed(2)}%`)}${note}`);

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

// Update the committed baseline, or fail the run on any degradation/ceiling breach.
if (process.env.UPDATE_BASELINE) {
	writeFileSync(baselinePath, JSON.stringify(updatedBaseline, null, '\t') + '\n');
	console.log(`Baseline updated: ${baselinePath}`);
} else if (failed) {
	console.log(red('\nE2E comparison failed — see ✗/▲ above (or bless with UPDATE_BASELINE=1).'));
	process.exitCode = 1;
}
