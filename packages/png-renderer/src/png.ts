import type { Canvas, Image } from '@napi-rs/canvas';
import {
	CanvasRenderer,
	LRUCache,
	SVGMapRenderer,
	viewSize,
	type RenderToSVGOptions,
	type SVGMapRendererOptions,
	type ViewOptions,
} from '@versatiles/renderer-core';
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
	 * to every later call. Only matters when {@link RenderToSVGOptions.labels} is `'text'`.
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
 * Each call starts from scratch: it parses the style and fetches the tiles and the
 * sprite again. To render many views of one style, use {@link PNGMapRenderer}, which
 * keeps them between renders.
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
 * import { writeFile } from 'node:fs/promises';
 *
 * const url = 'https://tiles.versatiles.org/assets/styles/colorful/style.json';
 * const style = await (await fetch(url)).json();
 *
 * const png = await renderToPNG({ style, lon: 13.4, lat: 52.52, zoom: 12 });
 * await writeFile('berlin.png', png);
 * ```
 *
 * @example Draw labels in the style's own fonts
 * ```ts
 * const png = await renderToPNG({
 *   style,
 *   lon: 13.4,
 *   lat: 52.52,
 *   zoom: 14,
 *   labels: 'text',
 *   fonts: { noto_sans_regular: 'fonts/NotoSans-Regular.ttf', noto_sans_bold: 'fonts/NotoSans-Bold.ttf' },
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
	return new PNGMapRenderer(options).renderPNG(options);
}

/**
 * Renders a MapLibre style onto a canvas, to draw on top of it or to encode it in another
 * format than PNG. Takes the options of {@link renderToPNG}; the canvas is described on
 * {@link PNGMapRenderer.renderCanvas}.
 *
 * @example Save a map as JPEG
 * ```ts
 * const canvas = await renderToCanvas({ style, lon: 13.4, lat: 52.52, zoom: 12 });
 * await writeFile('berlin.jpg', await canvas.encode('jpeg', 85));
 * ```
 *
 * @returns A `Canvas` of `@napi-rs/canvas`.
 * @throws As {@link renderToPNG}.
 */
export async function renderToCanvas(options: RenderToPNGOptions): Promise<Canvas> {
	return new PNGMapRenderer(options).renderCanvas(options);
}

/** Options for {@link PNGMapRenderer}: those of {@link SVGMapRenderer}, plus fonts. */
export interface PNGMapRendererOptions extends SVGMapRendererOptions {
	/**
	 * Font files to draw labels with, as `{ "<text-font name>": "<path to a font file>" }`.
	 * See {@link RenderToPNGOptions.fonts}.
	 */
	fonts?: Record<string, string>;
}

/** The view to render as PNG: {@link ViewOptions}, plus the pixel density. */
export interface PNGViewOptions extends ViewOptions {
	/**
	 * Pixel density, like a device pixel ratio. The image is `width * scale` by
	 * `height * scale` pixels, while the map is laid out as if it were `width` by `height`.
	 * See {@link RenderToPNGOptions.scale}.
	 * @defaultValue `1`
	 */
	scale?: number;
}

/**
 * How much memory decoded tiles and sprite sheets may take, in bytes of pixels (a 512 px
 * tile takes 1 MB).
 */
const IMAGE_CACHE_SIZE = 64 * 1024 * 1024;

/**
 * Renders many views of one MapLibre style, as PNG or SVG.
 *
 * An {@link SVGMapRenderer} that can also render PNG, sharing everything it keeps between
 * the two formats: the parsed style, the sprite and the tiles. For PNG it also keeps the
 * decoded tile and sprite images. Like {@link renderToPNG}, PNG rendering works in Node.js
 * only.
 *
 * @example Render several views of one style
 * ```ts
 * import { PNGMapRenderer } from '@versatiles/png-renderer';
 *
 * const map = new PNGMapRenderer({ style });
 *
 * const berlin = await map.renderPNG({ lon: 13.4, lat: 52.52, zoom: 12 });
 * const potsdam = await map.renderPNG({ lon: 13.06, lat: 52.4, zoom: 12 });
 * const svg = await map.renderSVG({ lon: 13.4, lat: 52.52, zoom: 12 });
 * ```
 */
export class PNGMapRenderer extends SVGMapRenderer {
	readonly #fonts: Record<string, string> | undefined;
	readonly #images = new LRUCache<Image>(
		IMAGE_CACHE_SIZE,
		(image) => image.width * image.height * 4,
	);
	#backend: Promise<CanvasBackend> | undefined;

	/** @param options - The style, whether to draw labels, the tile cache size, and fonts. */
	public constructor(options: PNGMapRendererOptions) {
		super(options);
		this.#fonts = options.fonts;
	}

	/**
	 * Renders one view of the map as PNG.
	 *
	 * @param view - Size, centre, zoom and pixel density. All optional.
	 * @returns The encoded PNG file, as described on {@link renderToPNG}.
	 * @throws If the `@napi-rs/canvas` binary cannot be loaded, if `width`, `height` or
	 *   `scale` is not positive, or if a font in `fonts` cannot be loaded.
	 */
	public async renderPNG(view: PNGViewOptions = {}): Promise<Uint8Array> {
		return (await this.#render(view)).toBuffer();
	}

	/**
	 * Renders one view of the map onto a canvas, to draw on top of it or to encode it in
	 * another format.
	 *
	 * The canvas is `width × scale` by `height × scale` pixels. Its 2D context is in its
	 * default state, except that it is scaled by `scale`: draw in the same units as
	 * `width` and `height`. Encode it with `canvas.encode('webp' | 'jpeg' | 'avif' | 'png')`
	 * or `canvas.toBuffer(…)`.
	 *
	 * The canvas records what is drawn and only paints the pixels when they are needed,
	 * usually when it is encoded, so drawing more on it costs little. Reading pixels
	 * (`getImageData`) paints everything recorded so far, every time it is called.
	 *
	 * @example Save a map as WebP
	 * ```ts
	 * const canvas = await map.renderCanvas({ lon: 13.4, lat: 52.52, zoom: 12 });
	 * await writeFile('berlin.webp', await canvas.encode('webp'));
	 * ```
	 *
	 * To draw on the map, see the example on {@link SVGMapRenderer.project}.
	 *
	 * @param view - Size, centre, zoom and pixel density. All optional.
	 * @returns A `Canvas` of `@napi-rs/canvas`.
	 * @throws As {@link PNGMapRenderer.renderPNG}.
	 */
	public async renderCanvas(view: PNGViewOptions = {}): Promise<Canvas> {
		return (await this.#render(view)).canvas;
	}

	/** Forgets the fetched tiles and sprite, and the decoded images. */
	public override clearCache(): void {
		super.clearCache();
		this.#images.clear();
	}

	/** Draws `view` onto a new canvas, finished: nothing clips or transforms it any more. */
	async #render(view: PNGViewOptions): Promise<CanvasRenderer> {
		const { width, height } = viewSize(view);
		const scale = view.scale ?? 1;
		if (scale <= 0) throw new Error('scale must be positive');

		const backend = await this.#loadBackend();
		const renderer = new CanvasRenderer({
			width,
			height,
			scale,
			createCanvas: backend.createCanvas,
			loadImage: backend.loadImage,
			images: this.#images,
		});
		return this.draw(renderer, view);
	}

	/**
	 * Loads the canvas backend and registers the fonts, once. A failure is not kept, so a
	 * later render tries again (e.g. after the font file was fixed).
	 */
	#loadBackend(): Promise<CanvasBackend> {
		if (this.#backend) return this.#backend;
		const fonts = this.#fonts;
		const backend = loadCanvasBackend().then((loaded) => {
			if (fonts) registerFonts(loaded, fonts);
			return loaded;
		});
		this.#backend = backend;
		backend.catch(() => {
			if (this.#backend === backend) this.#backend = undefined;
		});
		return backend;
	}
}
