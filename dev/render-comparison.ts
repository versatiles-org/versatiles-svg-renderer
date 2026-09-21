import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { chromium, firefox, webkit } from 'playwright';
import { inlineSources, osm } from '@versatiles/style';
import { renderToSVG } from '../packages/core/src/index.js';
import { ensureCacheDir, readCache, writeCache } from '../e2e/fetch-cache.js';
import { installMapLibrePage } from '../e2e/maplibre-page.js';
import type { BrowserType, Page } from 'playwright';

const WIDTH = 1024;
const HEIGHT = 768;
const LOCATION = {
	lon: 12.4914,
	lat: 41.8912,
	zoom: 17,
};
const outDir = resolve(import.meta.dirname, 'render-comparison-output');

mkdirSync(outDir, { recursive: true });

// Render SVG with symbols (icons) but no labels
console.log('Rendering SVG...');
const style = await inlineSources(osm({ theme: 'colorful', projection: 'mercator' }));

// Remove all symbol layers that only have text (keep ones with icons)
// Actually: renderLabels=true enables both icons and labels.
// To get icons without text labels, we filter out text-field from symbol layers.
for (const layer of style.layers) {
	if (layer.type === 'symbol' && 'layout' in layer && layer.layout) {
		// Remove text rendering but keep icon rendering
		//delete (layer.layout as Record<string, unknown>)['text-field'];
	}
}

const svg = await renderToSVG({
	width: WIDTH,
	height: HEIGHT,
	style,
	...LOCATION,
	renderLabels: true,
});

const svgPath = resolve(outDir, 'map.svg');
writeFileSync(svgPath, svg);
console.log(`  SVG saved: ${(Buffer.byteLength(svg) / 1024).toFixed(0)} KB`);

// Rasterize with Inkscape
console.log('Rasterizing with Inkscape...');
const inkscapePng = resolve(outDir, 'inkscape.png');
execSync(
	`inkscape "${svgPath}" --export-type=png --export-filename="${inkscapePng}" --export-width=${WIDTH} --export-height=${HEIGHT}`,
	{
		stdio: 'pipe',
	},
);
console.log('  Inkscape done.');

// Rasterize SVG with all Playwright browsers
const browsers: { name: string; type: BrowserType; args?: string[] }[] = [
	{ name: 'chromium', type: chromium, args: ['--use-gl=angle', '--use-angle=swiftshader'] },
	{ name: 'firefox', type: firefox },
	{ name: 'webkit', type: webkit },
];

for (const { name, type, args } of browsers) {
	console.log(`Rasterizing with ${name}...`);
	const png = resolve(outDir, `${name}.png`);
	const browser = await type.launch({ args });
	const page = await browser.newPage({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 1,
	});
	await page.setContent(`<!DOCTYPE html>
<html><head><style>* { margin: 0; padding: 0; }</style></head>
<body>${svg}</body></html>`);
	await page.screenshot({ path: png });
	await page.close();
	await browser.close();
	console.log(`  ${name} done.`);
}

// Render MapLibre GL JS reference screenshot
console.log('Rendering MapLibre GL JS...');
const maplibrePng = resolve(outDir, 'maplibre.png');

ensureCacheDir();
async function installPageCache(page: Page): Promise<void> {
	await page.route('https://**', async (route) => {
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
}

const maplibreStyle = await inlineSources(osm({ theme: 'colorful', projection: 'mercator' }));
for (const layer of maplibreStyle.layers) {
	if (layer.type === 'symbol' && 'layout' in layer && layer.layout) {
		delete (layer.layout as Record<string, unknown>)['text-field'];
	}
}

const mlBrowser = await chromium.launch({
	args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const mlPage = await mlBrowser.newPage({
	viewport: { width: WIDTH, height: HEIGHT },
	deviceScaleFactor: 1,
});
await installPageCache(mlPage);
await installMapLibrePage(mlPage, { width: WIDTH, height: HEIGHT });

// @ts-expect-error page.evaluate type instantiation too deep
await mlPage.evaluate(
	(options: any) => {
		return new Promise<void>((resolve, reject) => {
			const map = new (window as any).maplibregl.Map(options);
			map.once('idle', () => resolve());
			setTimeout(() => reject(new Error('MapLibre idle timeout')), 30000);
		});
	},
	{
		container: 'map',
		style: maplibreStyle,
		center: [LOCATION.lon, LOCATION.lat] as [number, number],
		zoom: LOCATION.zoom,
		interactive: false,
		fadeDuration: 0,
		attributionControl: false,
		pixelRatio: 1,
	},
);

await mlPage.screenshot({ path: maplibrePng });
await mlPage.close();
await mlBrowser.close();
console.log('  MapLibre done.');

// Generate comparison HTML
const svgSizeKB = (Buffer.byteLength(svg) / 1024).toFixed(0);

function card(label: string, sublabel: string, src: string): string {
	return `<div class="card">
	<a href="${src}"><img src="${src}" width="${WIDTH / 2}" height="${HEIGHT / 2}"></a>
	<div class="label">${label}</div>
	<div class="sublabel">${sublabel}</div>
</div>`;
}

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Label &amp; Icon Rendering Comparison (experimental)</title>
<style>
	*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
	body { font-family: system-ui, -apple-system, sans-serif; background: #f0f0f0; color: #1a1a1a; padding: 2rem; }
	header { max-width: 1200px; margin: 0 auto 2rem; }
	h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
	.description { font-size: 0.9rem; color: #444; margin-bottom: 0.5rem; line-height: 1.5; }
	.description code { background: #e0e0e0; padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.85em; }
	.meta { font-size: 0.85rem; color: #666; }
	.meta span { margin-right: 1.5rem; }
	h2 { font-size: 1.1rem; font-weight: 600; color: #444; margin: 2rem auto 0.75rem; max-width: 1200px; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, ${WIDTH / 2}px); gap: 1rem; max-width: 1200px; margin: 0 auto; }
	.card { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: box-shadow 0.15s; }
	.card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
	.card a { display: block; line-height: 0; }
	.card img { width: ${WIDTH / 2}px; height: ${HEIGHT / 2}px; }
	.label { padding: 0.6rem 0.8rem 0.1rem; font-weight: 600; font-size: 0.9rem; }
	.sublabel { padding: 0.1rem 0.8rem 0.6rem; font-size: 0.8rem; color: #888; }
</style>
</head><body>
<header>
	<h1>Label &amp; Icon Rendering Comparison</h1>
	<p class="description">This report compares the experimental <code>renderLabels</code> feature, which enables rendering of text labels and icons in the SVG output. This feature is optional and may produce imperfect results, since the original layouting engine of MapLibre GL JS cannot be used.</p>
	<div class="meta">
		<span>Location: ${LOCATION.lat}, ${LOCATION.lon} @ zoom ${LOCATION.zoom}</span>
		<span>SVG size: ${svgSizeKB} KB</span>
	</div>
</header>
<h2>Reference</h2>
<div class="grid">
	${card('MapLibre GL JS', 'Reference rendering', 'maplibre.png')}
	${card('SVG', 'Rendered in this browser', 'map.svg')}
</div>
<h2>SVG rasterized with …</h2>
<div class="grid">
	${card('Inkscape', 'SVG rasterized with Inkscape', 'inkscape.png')}
	${card('Chromium', 'SVG rasterized with Chromium', 'chromium.png')}
	${card('Firefox', 'SVG rasterized with Firefox', 'firefox.png')}
	${card('WebKit', 'SVG rasterized with WebKit', 'webkit.png')}
</div>
</body></html>`;

const reportPath = resolve(outDir, 'report.html');
writeFileSync(reportPath, html);
console.log(`\nReport: ${reportPath}`);
