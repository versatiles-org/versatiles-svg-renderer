import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { drawMap } from './pipeline/render.js';
import { CanvasRenderer } from './renderer/canvas.js';

/**
 * The canvas backend is an *optional* peer dependency, so it is imported dynamically:
 * installing this package for SVG output alone must not pull in a 27 MB native binary,
 * and the browser bundle must never reach this module at all (see rollup.config.ts).
 */
type CanvasBackend = typeof import('@napi-rs/canvas');

let backend: Promise<CanvasBackend> | undefined;

export async function loadCanvasBackend(): Promise<CanvasBackend> {
	backend ??= import('@napi-rs/canvas');
	try {
		return await backend;
	} catch (cause: unknown) {
		// Don't cache the failure: the caller may install the package and retry.
		backend = undefined;
		throw new Error(
			'PNG rendering needs the optional peer dependency "@napi-rs/canvas". ' +
				'Install it with `npm install @napi-rs/canvas`.',
			{ cause },
		);
	}
}

export interface RenderToPNGOptions {
	width?: number;
	height?: number;
	style: StyleSpecification;
	lon?: number;
	lat?: number;
	zoom?: number;
	renderLabels?: boolean;
	/**
	 * Device pixel ratio. The image is `width * scale` by `height * scale` pixels, while
	 * the map is laid out as if it were `width` by `height` — so strokes, text and icons
	 * keep their size and simply gain detail, like a 2× screenshot.
	 */
	scale?: number;
	/**
	 * Fonts to make available to labels, as `{ "<text-font name>": "<path to a font file>" }`.
	 * A style names its fonts (`text-font: ["noto_sans_regular"]`) but does not ship them,
	 * and MapLibre's own glyph server serves pre-rendered SDF bitmaps that a canvas cannot
	 * use — so to draw labels in the intended typeface, point each name at a real font file
	 * (TTF, OTF, WOFF or WOFF2). Names left unregistered fall back to whatever the machine
	 * has installed, which is usually not the font the style asked for.
	 *
	 * Registration is process-wide (the backend keeps one font registry), so a name
	 * registered by one render is visible to every later one.
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

export async function renderToPNG(options: RenderToPNGOptions): Promise<Buffer> {
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
