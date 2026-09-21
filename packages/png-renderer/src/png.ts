import type { RenderToSVGOptions } from '@versatiles/renderer-core/render_svg';
import { drawMap } from '@versatiles/renderer-core/pipeline/render';
import { CanvasRenderer } from '@versatiles/renderer-core/renderer/canvas';
import { type CanvasBackend, loadCanvasBackend } from './canvas_backend.js';

/**
 * Options for {@link renderToPNG}: everything {@link RenderToSVGOptions} takes, plus the
 * pixel density of the image and the fonts to draw labels with.
 */
export interface RenderToPNGOptions extends RenderToSVGOptions {
	/**
	 * Pixel density, like a device pixel ratio. The image is `width * scale` by
	 * `height * scale` pixels, while the map is laid out as if it were `width` by `height`
	 * — so lines, text and icons keep their size and gain detail, as in a 2× screenshot.
	 * Use `2` for a sharp image on high-resolution screens.
	 * @defaultValue `1`
	 */
	scale?: number;
	/**
	 * Font files to draw labels with, as `{ "<text-font name>": "<path to a font file>" }`.
	 *
	 * A style only *names* its fonts (`"text-font": ["noto_sans_regular"]`). MapLibre
	 * draws them from pre-rendered glyphs on the style's glyph server, which this renderer
	 * does not use: it draws text with real font files instead. Map each name the style
	 * uses to a TTF, OTF, WOFF or WOFF2 file. A name left unmapped falls back to a font
	 * installed on the machine, which is usually not the one the style asked for.
	 *
	 * Fonts are registered process-wide, so a name registered by one call stays available
	 * to every later call. Only matters when {@link RenderToSVGOptions.renderLabels} is on.
	 */
	fonts?: Record<string, string>;
}

/** Registered `name\0file` pairs, so repeated renders do not re-register the same fonts. */
const registeredFonts = new Set<string>();

function registerFonts(backend: CanvasBackend, fonts: Record<string, string>): void {
	for (const [name, file] of Object.entries(fonts)) {
		const key = `${name}\0${file}`;
		if (registeredFonts.has(key)) continue;
		// Returns a font key on success and null on failure — a missing file and an
		// unparseable one look the same, so report the path either way.
		if (!backend.GlobalFonts.registerFromPath(file, name)) {
			throw new Error(`Could not register the font "${name}" from ${file}`);
		}
		registeredFonts.add(key);
	}
}

/**
 * Renders a MapLibre style to a PNG image.
 *
 * Takes the same options as {@link renderToSVG} and draws the same map, but rasterizes it
 * directly instead of producing SVG — no browser or SVG rasterizer needed. Satellite and
 * other raster tiles in WebP work too, which many SVG rasterizers cannot decode.
 *
 * **Node.js only.** It draws with the native canvas backend `@napi-rs/canvas`, a dependency
 * of this package that npm installs together with it, including the prebuilt binary for
 * the platform. If that binary is missing (e.g. installed with `--omit=optional`, or
 * `node_modules` copied from another OS or CPU architecture), this function throws an error
 * that names the platform and the missing package.
 *
 * @example Render a map to a file
 * ```ts
 * import { renderToPNG } from '@versatiles/png-renderer';
 * import { inlineSources, osm } from '@versatiles/style';
 * import { writeFile } from 'node:fs/promises';
 *
 * // As with renderToSVG, the style's sources must list their tile URLs.
 * const style = await inlineSources(osm({ theme: 'colorful' }));
 *
 * const png = await renderToPNG({
 *   style,
 *   width: 800,
 *   height: 600,
 *   lon: 13.4, // Berlin
 *   lat: 52.52,
 *   zoom: 12,
 *   scale: 2, // 1600 × 1200 pixels, for high-resolution screens
 * });
 *
 * await writeFile('berlin.png', png);
 * ```
 *
 * @example Draw labels in the style's own fonts
 * ```ts
 * // The VersaTiles styles use Noto Sans. One source is `npm install @fontsource/noto-sans`
 * // (its "latin" files cover Western European scripts; it ships others alongside).
 * const files = 'node_modules/@fontsource/noto-sans/files';
 * const png = await renderToPNG({
 *   style,
 *   lon: 13.4,
 *   lat: 52.52,
 *   zoom: 14,
 *   renderLabels: true,
 *   fonts: {
 *     noto_sans_regular: `${files}/noto-sans-latin-400-normal.woff2`,
 *     noto_sans_bold: `${files}/noto-sans-latin-700-normal.woff2`,
 *   },
 * });
 * ```
 *
 * @param options - What to render, how large, and at what pixel density. Only `style` is
 *   required.
 * @returns The encoded PNG file. It is typed as a `Uint8Array` so that using this package
 *   does not require Node's type definitions; at runtime it is a Node `Buffer`, and either
 *   way it can be written with `fs.writeFile` as is.
 * @throws If the `@napi-rs/canvas` binary cannot be loaded, if `width`, `height` or `scale` is not
 *   positive, or if a font in `fonts` cannot be loaded.
 */
export async function renderToPNG(options: RenderToPNGOptions): Promise<Uint8Array> {
	const width = options.width ?? 1024;
	const height = options.height ?? 1024;
	const scale = options.scale ?? 1;

	if (width <= 0) throw new Error('width must be positive');
	if (height <= 0) throw new Error('height must be positive');
	if (scale <= 0) throw new Error('scale must be positive');

	const backend = await loadCanvasBackend();
	if (options.fonts) registerFonts(backend, options.fonts);

	const renderer = new CanvasRenderer({
		width,
		height,
		scale,
		createCanvas: backend.createCanvas,
		loadImage: backend.loadImage,
	});

	await drawMap({
		renderer,
		style: options.style,
		view: {
			center: [options.lon ?? 0, options.lat ?? 0],
			zoom: options.zoom ?? 2,
		},
		renderLabels: options.renderLabels ?? false,
	});

	return renderer.toBuffer();
}
