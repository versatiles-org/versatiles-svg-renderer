/**
 * Renders a region three ways, each at the same size and pixel ratio: with MapLibre GL JS
 * (the reference), with the SVG renderer (rasterized by Chromium), and with the PNG renderer
 * (in process). Each image is also written to its folder in `output/`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { renderToSVG } from '../../packages/svg-renderer/src/index.js';
import { renderToPNG } from '../../packages/png-renderer/src/index.js';
import { readCache, writeCache } from '../shared/fetch-cache.js';
import { readFixture } from '../shared/fixtures.js';
import { installMapLibrePage } from '../shared/maplibre-page.js';
import type { Region } from './regions.js';
import { fonts } from './styles.js';
import { folders, HEIGHT, SCALE, WIDTH } from './output.js';

/** The three renders of a region, and the sizes of the renderers' files. */
export interface Shots {
	maplibre: PNG;
	svg: PNG;
	png: PNG;
	svgSizeKB: number;
	pngSizeKB: number;
}

export class Capture {
	readonly #browser: Browser;
	readonly #onWarning: (message: string) => void;

	private constructor(browser: Browser, onWarning: (message: string) => void) {
		this.#browser = browser;
		this.#onWarning = onWarning;
	}

	/** Starts the browser. `onWarning` receives what the renderers report as not drawn. */
	public static async launch(onWarning: (message: string) => void): Promise<Capture> {
		const browser = await chromium.launch({
			args: ['--use-gl=angle', '--use-angle=swiftshader'],
		});
		return new Capture(browser, onWarning);
	}

	/**
	 * Renders `region` all three ways. Chromium occasionally refuses to capture a frame on a
	 * loaded CI runner ("Page.captureScreenshot: Unable to capture screenshot"), which has
	 * nothing to do with what is rendered: then the region is tried again on fresh pages,
	 * and `onRetry` is told, so that a real regression stays visible.
	 */
	public async shots(
		region: Region,
		style: StyleSpecification,
		onRetry: (message: string) => void,
		attempts = 3,
	): Promise<Shots> {
		for (let attempt = 1; ; attempt++) {
			try {
				const [svg, png, maplibre] = await Promise.all([
					this.#svg(region, style),
					this.#png(region, style),
					this.#maplibre(region, style),
				]);
				return {
					maplibre,
					svg: svg.png,
					png: png.png,
					svgSizeKB: svg.sizeKB,
					pngSizeKB: png.sizeKB,
				};
			} catch (error) {
				if (attempt >= attempts) throw error;
				onRetry(`attempt ${String(attempt)}/${String(attempts)} failed (${String(error)})`);
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
	}

	public async close(): Promise<void> {
		await this.#browser.close();
	}

	async #newPage(label: string, id: string): Promise<Page> {
		const page = await this.#browser.newPage({
			viewport: { width: WIDTH, height: HEIGHT },
			deviceScaleFactor: SCALE,
		});
		page.on('crash', () => console.log(`  ${id}: ${label} page crashed`));
		return page;
	}

	/** The region rendered by MapLibre GL JS in a headless page. */
	async #maplibre(region: Region, style: StyleSpecification): Promise<PNG> {
		const page = await this.#newPage('MapLibre', region.id);
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
					padding,
					pixelRatio,
				}: {
					styleJson: any;
					center: [number, number];
					zoom: number;
					bearing: number;
					padding: Record<string, number> | undefined;
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
						if (padding) map.setPadding(padding);
						map.once('idle', () => resolve());
						setTimeout(() => reject(new Error('MapLibre idle timeout')), 30000);
					});
				},
				{
					styleJson: style,
					center: [region.view.lon, region.view.lat] as [number, number],
					zoom: region.view.zoom,
					bearing: region.view.bearing ?? 0,
					padding: region.view.padding,
					pixelRatio: SCALE,
				},
			);

			const buffer = await page.screenshot({ path: resolve(folders.maplibre, `${region.id}.png`) });
			return PNG.sync.read(buffer);
		} finally {
			await page.close();
		}
	}

	/** The region rendered as SVG, and the SVG rasterized by Chromium. */
	async #svg(region: Region, style: StyleSpecification): Promise<{ png: PNG; sizeKB: number }> {
		const svg = await renderToSVG({
			width: WIDTH,
			height: HEIGHT,
			style,
			...renderView(region),
			onWarning: this.#onWarning,
		});
		writeFileSync(resolve(folders.svg, `${region.id}.svg`), svg);

		const page = await this.#newPage('SVG', region.id);
		try {
			await page.setContent(`<!DOCTYPE html>
<html><head><style>* { margin: 0; padding: 0; }
${fontFaces()}</style></head>
<body>${svg}</body></html>`);
			const buffer = await page.screenshot({ path: resolve(folders.svg, `${region.id}.png`) });
			return { png: PNG.sync.read(buffer), sizeKB: Buffer.byteLength(svg, 'utf8') / 1024 };
		} finally {
			await page.close();
		}
	}

	/**
	 * The region rendered by the PNG renderer. No browser is involved — it renders in
	 * process — so this costs a fraction of the two screenshot passes.
	 *
	 * The returned pixels are flattened onto white: the canvas backend leaves anything it
	 * does not paint transparent (the area around the globe, most obviously), while the two
	 * screenshots come off a white page. Diffing them unflattened reports every unpainted
	 * pixel as a mismatch, which on a globe region is most of the image.
	 */
	async #png(region: Region, style: StyleSpecification): Promise<{ png: PNG; sizeKB: number }> {
		const buffer = await renderToPNG({
			width: WIDTH,
			height: HEIGHT,
			scale: SCALE,
			style,
			...renderView(region),
			fonts,
			onWarning: this.#onWarning,
		});
		writeFileSync(resolve(folders.png, `${region.id}.png`), buffer);
		// `renderToPNG` returns a Uint8Array (its public type carries no Node globals); pngjs
		// wants a Buffer, which wraps the same memory without copying it.
		const asBuffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		return { png: flattenOnWhite(PNG.sync.read(asBuffer)), sizeKB: buffer.byteLength / 1024 };
	}
}

/** The view and labels of `region`, as the renderers' options. */
function renderView(region: Region) {
	return {
		lon: region.view.lon,
		lat: region.view.lat,
		zoom: region.view.zoom,
		bearing: region.view.bearing ?? 0,
		padding: region.view.padding,
		labels: region.labels ? ('glyphs-text' as const) : ('none' as const),
	};
}

/**
 * Serves a page's requests (maplibre-gl, tiles, sprites, glyphs) from the fixtures and the
 * disk cache, and caches what it does not have yet.
 */
async function installPageCache(page: Page): Promise<void> {
	await page.route('**/*', async (route) => {
		const url = route.request().url();
		const fixture = readFixture(url);
		if (fixture) {
			await route.fulfill(fixture);
			return;
		}
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

let fontFaceRules: string | undefined;

/**
 * `@font-face` rules for the same fonts the PNG backend registers. The SVG only *names*
 * its fonts — resolving them is the viewer's job — so the page that rasterizes it has to
 * supply them, or the two renderers would be compared drawing different typefaces.
 */
function fontFaces(): string {
	fontFaceRules ??= Object.entries(fonts)
		.map(([name, file]) => {
			const data = readFileSync(file).toString('base64');
			return `@font-face { font-family: "${name}"; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
		})
		.join('\n');
	return fontFaceRules;
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
