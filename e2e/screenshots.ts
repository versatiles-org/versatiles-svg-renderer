import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { renderToSVG } from '../packages/svg-renderer/src/index.js';
import { renderToPNG } from '../packages/png-renderer/src/index.js';
import type { Page } from 'playwright';
import { ensureCacheDir, installFetchCache, readCache, writeCache } from './fetch-cache.js';
import { installMapLibrePage } from './maplibre-page.js';
import { fonts, getStyle, regionId, regions, type Region } from './styles.js';

installFetchCache();

const WIDTH = 800;
const HEIGHT = 600;
// Render both the SVG and MapLibre at a higher device pixel ratio. The SVG is
// vector so it gains real detail; MapLibre must be told to match via its map
// `pixelRatio` (otherwise it renders at 1x and the screenshot just upscales).
// AA noise lives on edges (∝ length) while the image is area (∝ size²), so a higher
// ratio shrinks the AA-noise fraction of the diff without hiding real differences.
const SCALE = 2;
const SW = WIDTH * SCALE;
const SH = HEIGHT * SCALE;

// pixelmatch's per-pixel color tolerance (YIQ distance, 0..1). Its default of 0.1 is too
// lenient for vector maps: it rates a missing light background (e.g. rgb(248,244,240)
// vs. white) as identical, since that distance corresponds to a threshold of ~0.04.
// Raster imagery keeps the default: the browser and MapLibre resample images slightly
// differently, so a stricter threshold there only measures resampling noise.
const PIXELMATCH_THRESHOLD: Record<Region['type'], number> = {
	vector: 0.03,
	geojson: 0.03,
	features: 0.03,
	satellite: 0.1,
};

const outputDir = resolve(import.meta.dirname, 'output');
const maplibreDir = resolve(outputDir, 'maplibre');
const svgDir = resolve(outputDir, 'svg');
const pngDir = resolve(outputDir, 'png');
const diffDir = resolve(outputDir, 'diff');
const diffPngDir = resolve(outputDir, 'diff-png');
const driftDir = resolve(outputDir, 'drift');

for (const dir of [outputDir, maplibreDir, svgDir, pngDir, diffDir, diffPngDir, driftDir]) {
	mkdirSync(dir, { recursive: true });
}

console.log('Launching browser...');
const browser = await chromium.launch({
	args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

// Cache browser network requests (unpkg.com, tile servers) to disk.
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

/**
 * `@font-face` rules for the same fonts the PNG backend registers. The SVG only *names*
 * its fonts — resolving them is the viewer's job — so the page that rasterizes it has to
 * supply them, or the two renderers would be compared drawing different typefaces.
 */
const fontFaces = Object.entries(fonts)
	.map(([name, file]) => {
		const data = readFileSync(file).toString('base64');
		return `@font-face { font-family: "${name}"; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
	})
	.join('\n');

// What the renderers report as not drawn, collected per region: both renderers report the
// same parts of the style, so each warning is printed once, below the region's line.
const warnings = new Set<string>();
const collectWarning = (message: string): void => {
	warnings.add(message);
};

// Render the region's SVG and rasterize it; returns the screenshot + SVG size (KB).
async function renderSvgShot(
	region: Region,
	style: StyleSpecification,
): Promise<{ png: PNG; sizeKB: number }> {
	const id = regionId(region);
	const svg = await renderToSVG({
		width: WIDTH,
		height: HEIGHT,
		style,
		lon: region.lon,
		lat: region.lat,
		zoom: region.zoom,
		bearing: region.bearing ?? 0,
		renderLabels: region.labels ?? false,
		onWarning: collectWarning,
	});
	writeFileSync(resolve(svgDir, `${id}.svg`), svg);

	const page = await browser.newPage({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: SCALE,
	});
	page.on('crash', () => console.log(`  ${id}: SVG page crashed`));
	try {
		await page.setContent(`<!DOCTYPE html>
<html><head><style>* { margin: 0; padding: 0; }
${fontFaces}</style></head>
<body>${svg}</body></html>`);
		const buffer = await page.screenshot({ path: resolve(svgDir, `${id}.png`) });
		return { png: PNG.sync.read(buffer), sizeKB: Buffer.byteLength(svg, 'utf8') / 1024 };
	} finally {
		await page.close();
	}
}

/**
 * Render the region with the canvas (PNG) backend. No browser is involved — it renders in
 * process — so this costs a fraction of the two screenshot passes.
 *
 * The returned pixels are flattened onto white: the canvas backend leaves anything it does
 * not paint transparent (the area around the globe, most obviously), while the two
 * screenshots come off a white page. Diffing them unflattened reports every unpainted
 * pixel as a mismatch, which on a globe region is most of the image.
 */
async function renderPngShot(
	region: Region,
	style: StyleSpecification,
): Promise<{ png: PNG; sizeKB: number }> {
	const id = regionId(region);
	const buffer = await renderToPNG({
		width: WIDTH,
		height: HEIGHT,
		scale: SCALE,
		style,
		lon: region.lon,
		lat: region.lat,
		zoom: region.zoom,
		bearing: region.bearing ?? 0,
		renderLabels: region.labels ?? false,
		fonts,
		onWarning: collectWarning,
	});
	writeFileSync(resolve(pngDir, `${id}.png`), buffer);
	// `renderToPNG` returns a Uint8Array (its public type carries no Node globals); pngjs
	// wants a Buffer, which wraps the same memory without copying it.
	const asBuffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	return { png: flattenOnWhite(PNG.sync.read(asBuffer)), sizeKB: buffer.byteLength / 1024 };
}

function flattenOnWhite(png: PNG): PNG {
	const out = new PNG({ width: png.width, height: png.height });
	for (let i = 0; i < png.data.length; i += 4) {
		const alpha = png.data[i + 3]! / 255;
		for (let channel = 0; channel < 3; channel++) {
			out.data[i + channel] = Math.round(png.data[i + channel]! * alpha + 255 * (1 - alpha));
		}
		out.data[i + 3] = 255;
	}
	return out;
}

// Render the same region with MapLibre GL in a headless page.
async function renderMapLibreShot(region: Region, style: StyleSpecification): Promise<PNG> {
	const id = regionId(region);
	const page = await browser.newPage({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: SCALE,
	});
	page.on('crash', () => console.log(`  ${id}: MapLibre page crashed`));
	try {
		await installPageCache(page);
		await installMapLibrePage(page, { width: WIDTH, height: HEIGHT });

		// @ts-expect-error page.evaluate type instantiation too deep
		await page.evaluate(
			({
				styleJson,
				center,
				zoom,
				bearing,
				pixelRatio,
			}: {
				styleJson: any;
				center: [number, number];
				zoom: number;
				bearing: number;
				pixelRatio: number;
			}) => {
				return new Promise<void>((resolve, reject) => {
					const map = new (window as any).maplibregl.Map({
						container: 'map',
						style: styleJson,
						center,
						zoom,
						bearing,
						interactive: false,
						fadeDuration: 0,
						attributionControl: false,
						pixelRatio,
					});
					map.once('idle', () => resolve());
					setTimeout(() => reject(new Error('MapLibre idle timeout')), 30000);
				});
			},
			{
				styleJson: style,
				center: [region.lon, region.lat] as [number, number],
				zoom: region.zoom,
				bearing: region.bearing ?? 0,
				pixelRatio: SCALE,
			},
		);

		const buffer = await page.screenshot({ path: resolve(maplibreDir, `${id}.png`) });
		return PNG.sync.read(buffer);
	} finally {
		await page.close();
	}
}

// --- Comparison setup ---

const useColor = !process.env.NO_COLOR;
const paint = (code: number, s: string): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s: string): string => paint(31, s);
const green = (s: string): string => paint(32, s);
const dim = (s: string): string => paint(90, s);

/**
 * What is measured per region: each renderer against the MapLibre reference, plus the
 * drift between the two renderers (which catches a backend diverging even while both stay
 * near MapLibre).
 */
interface Metrics {
	svg: number;
	png: number;
	drift: number;
}

type MetricName = keyof Metrics;
const METRICS: MetricName[] = ['svg', 'png', 'drift'];

// Baselines hold the highest value seen across the environments that run this suite, so
// the gate passes in all of them; a lower number elsewhere reads as an improvement rather
// than a failure. Re-bless with UPDATE_BASELINE=1, and keep the higher figure when an
// environment disagrees.
const baselinePath = resolve(import.meta.dirname, 'diff-baseline.json');
// A baseline entry used to be a single number: the SVG-vs-MapLibre diff. Those are still
// read, so the blessed values survive; the next `UPDATE_BASELINE=1` writes the newer form.
const rawBaseline: Record<string, number | Partial<Metrics>> = existsSync(baselinePath)
	? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number | Partial<Metrics>>)
	: {};
const baseline: Record<string, Partial<Metrics>> = Object.fromEntries(
	Object.entries(rawBaseline).map(([id, value]) => [
		id,
		typeof value === 'number' ? { svg: value } : value,
	]),
);

// A change counts as degradation/improvement only if it clears both a 10% relative move
// and a 0.1 percentage-point floor.
//
// These are deliberately looser than the measurement is precise. The same commit does not
// produce the same numbers everywhere: `png` and `drift` compare a Skia-rendered image
// against a Chromium one, so they carry each rasterizer's platform differences, and text
// is the worst of it — between macOS and Linux the labels region moves by whole
// percentage points while everything else stays within 0.05. Three environments run this
// suite (a developer's machine, the CI runner, and the Pages container), and a baseline
// tight enough to be exact in one of them just fails in the other two.
const REL_TOLERANCE = 0.1;
const ABS_FLOOR = 0.1;
// The hard ceiling is derived from the baseline rather than hand-maintained: a diff
// must stay under max(baseline * 1.5, baseline + 0.5%). It's the backstop above the
// (stricter) degradation check.
const ceilingFor = (base: number): number => Math.max(base * 1.5, base + 0.5);

/**
 * Compares one measurement against its blessed baseline, with the same rules for every
 * metric: a hard ceiling derived from the baseline, and a degradation/improvement band.
 */
function gate(
	value: number,
	base: number | undefined,
): { note: string; color: (s: string) => string; failed: boolean } {
	if (base === undefined) {
		return { note: dim(' (no baseline)'), color: (t) => t, failed: false };
	}
	const ceiling = ceilingFor(base);
	const delta = value - base;
	const significant = Math.abs(delta) > Math.max(base * REL_TOLERANCE, ABS_FLOOR);
	if (value > ceiling) {
		return { note: red(` ✗ over ${ceiling.toFixed(2)}%`), color: red, failed: true };
	}
	if (significant && delta > 0) {
		return { note: red(` ▲ was ${base.toFixed(2)}%`), color: red, failed: true };
	}
	if (significant && delta < 0) {
		return { note: green(` ▼ was ${base.toFixed(2)}%`), color: green, failed: false };
	}
	return { note: '', color: (t) => t, failed: false };
}

// Chromium occasionally refuses to capture a frame on a loaded CI runner
// ("Page.captureScreenshot: Unable to capture screenshot"), which has nothing to do
// with what is being rendered. Retry the region on fresh pages instead of failing the
// whole run on a one-off, and log every retry so a real regression stays visible.
async function withRetry<T>(id: string, render: () => Promise<T>, attempts = 3): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await render();
		} catch (error) {
			if (attempt >= attempts) throw error;
			console.log(
				dim(`  ${id}: attempt ${attempt}/${attempts} failed (${String(error)}) — retrying`),
			);
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
}

interface Result {
	region: Region;
	id: string;
	metrics: Metrics;
	svgSizeKB: number;
	pngSizeKB: number;
}

const results: Result[] = [];
const updatedBaseline: Record<string, Metrics> = {};
let failed = false;

// For each region: render all three ways, diff each renderer against MapLibre and the two
// renderers against each other, and report one line per region.
// `E2E_REGIONS=parity-features,berlin-vector` runs only these regions (by their id).
const selectedIds = process.env.E2E_REGIONS?.split(',').map((id) => id.trim());
const selectedRegions = selectedIds
	? regions.filter((region) => selectedIds.includes(regionId(region)))
	: regions;

for (const region of selectedRegions) {
	const id = regionId(region);
	const style = await getStyle(region);

	let svgPng: PNG;
	let pngPng: PNG;
	let maplibrePng: PNG;
	let svgSizeKB: number;
	let pngSizeKB: number;
	try {
		const [svgShot, pngShot, maplibre] = await withRetry(id, () =>
			Promise.all([
				renderSvgShot(region, style),
				renderPngShot(region, style),
				renderMapLibreShot(region, style),
			]),
		);
		svgPng = svgShot.png;
		svgSizeKB = svgShot.sizeKB;
		pngPng = pngShot.png;
		pngSizeKB = pngShot.sizeKB;
		maplibrePng = maplibre;
	} catch (error) {
		console.log(red(`  ${id}: render failed — ${String(error)}`));
		failed = true;
		continue;
	}

	const threshold = PIXELMATCH_THRESHOLD[region.type];
	const compare = (a: PNG, b: PNG, file: string): number => {
		const diff = new PNG({ width: SW, height: SH });
		const mismatch = pixelmatch(a.data, b.data, diff.data, SW, SH, { threshold });
		writeFileSync(file, PNG.sync.write(diff));
		return (mismatch / (SW * SH)) * 100;
	};

	const metrics: Metrics = {
		svg: compare(maplibrePng, svgPng, resolve(diffDir, `${id}.png`)),
		png: compare(maplibrePng, pngPng, resolve(diffPngDir, `${id}.png`)),
		drift: compare(svgPng, pngPng, resolve(driftDir, `${id}.png`)),
	};
	updatedBaseline[id] = {
		svg: Math.round(metrics.svg * 100) / 100,
		png: Math.round(metrics.png * 100) / 100,
		drift: Math.round(metrics.drift * 100) / 100,
	};

	const parts = METRICS.map((name) => {
		const { note, color, failed: regressed } = gate(metrics[name], baseline[id]?.[name]);
		if (regressed) failed = true;
		return `${color(`${name} ${metrics[name].toFixed(2)}%`)}${note}`;
	});
	console.log(`  ${id}: ${parts.join('  ')}`);
	for (const warning of warnings) console.log(dim(`    not drawn: ${warning}`));
	warnings.clear();

	results.push({ region, id, metrics, svgSizeKB, pngSizeKB });
}

await browser.close();

// --- HTML report ---
// Six image columns, so they are sized to stay readable side by side rather than at the
// half-width a three-column table allowed.
const THUMB = Math.round(WIDTH / 3);

const metricCell = (label: string, value: number, base: number | undefined): string => {
	// Grade against the baseline, exactly as the console does, so a regression cannot read
	// as green here just because its absolute value happens to be small.
	const { failed: regressed, note } = gate(value, base);
	const improved = note.includes('▼');
	const color = regressed ? 'red' : improved ? 'green' : value > 20 ? 'orange' : '#333';
	const mark = regressed ? ' ▲' : improved ? ' ▼' : '';
	const was =
		base === undefined ? '' : ` <span style="color:#888">(was ${base.toFixed(2)}%)</span>`;
	return `<div><strong>${label}:</strong> <span style="color:${color}">${value.toFixed(2)}%${mark}</span>${was}</div>`;
};

const rows = results
	.map((r) => {
		const base = baseline[r.id];
		const thumb = (dir: string, file: string, link: string): string =>
			`<td><a href="${link}"><img src="${dir}/${file}" width="${THUMB}" height="${Math.round((THUMB * HEIGHT) / WIDTH)}"></a></td>`;
		return `<tr>
	<td>
		<strong>${r.id}</strong><br>
		lon: ${r.region.lon}<br>
		lat: ${r.region.lat}<br>
		zoom: ${r.region.zoom}<br>${r.region.bearing ? `\n\t\tbearing: ${r.region.bearing}<br>` : ''}
		type: ${r.region.type}${r.region.labels ? ' + labels' : ''}<br>
		SVG: ${r.svgSizeKB.toFixed(0)} KB<br>
		PNG: ${r.pngSizeKB.toFixed(0)} KB<br>
		${metricCell('SVG vs ML', r.metrics.svg, base?.svg)}
		${metricCell('PNG vs ML', r.metrics.png, base?.png)}
		${metricCell('drift', r.metrics.drift, base?.drift)}
	</td>
	${thumb('maplibre', `${r.id}.png`, `maplibre/${r.id}.png`)}
	${thumb('svg', `${r.id}.png`, `svg/${r.id}.svg`)}
	${thumb('png', `${r.id}.png`, `png/${r.id}.png`)}
	${thumb('diff', `${r.id}.png`, `diff/${r.id}.png`)}
	${thumb('diff-png', `${r.id}.png`, `diff-png/${r.id}.png`)}
	${thumb('drift', `${r.id}.png`, `drift/${r.id}.png`)}
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
	th { background: #eee; position: sticky; top: 0; z-index: 2; }
	/* The table is wider than most screens; keep each region and its numbers in view. */
	td:first-child, th:first-child { position: sticky; left: 0; }
	th:first-child { z-index: 3; }
	img { display: block; }
	td div { margin-top: 4px; white-space: nowrap; }
</style>
</head><body>
<h1>E2E Visual Comparison Report</h1>
<p>Generated: ${new Date().toISOString()}</p>
<p>
	MapLibre is the reference. <em>SVG vs ML</em> and <em>PNG vs ML</em> grade each renderer
	against it; <em>drift</em> is the two renderers against each other, which catches one
	backend diverging even while both stay close to MapLibre.
</p>
<table>
<tr>
	<th>Region</th>
	<th>MapLibre (reference)</th>
	<th>SVG renderer</th>
	<th>PNG renderer</th>
	<th>Diff: SVG vs ML</th>
	<th>Diff: PNG vs ML</th>
	<th>Drift: SVG vs PNG</th>
</tr>
${rows}
</table>
</body></html>`;

const reportPath = resolve(outputDir, 'report.html');
writeFileSync(reportPath, html);
console.log(`\nReport saved to: ${reportPath}`);

// Update the committed baseline, or fail the run on any degradation/ceiling breach.
if (process.env.UPDATE_BASELINE) {
	// A run of selected regions updates only their entries.
	const blessed = selectedIds ? { ...rawBaseline, ...updatedBaseline } : updatedBaseline;
	writeFileSync(baselinePath, JSON.stringify(blessed, null, '\t') + '\n');
	console.log(`Baseline updated: ${baselinePath}`);
} else if (failed) {
	console.log(red('\nE2E comparison failed — see ✗/▲ above (or bless with UPDATE_BASELINE=1).'));
	process.exitCode = 1;
}
