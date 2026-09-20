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
}

export async function renderToPNG(options: RenderToPNGOptions): Promise<Buffer> {
	const width = options.width ?? 1024;
	const height = options.height ?? 1024;
	const scale = options.scale ?? 1;

	if (width <= 0) throw new Error('width must be positive');
	if (height <= 0) throw new Error('height must be positive');
	if (scale <= 0) throw new Error('scale must be positive');

	const { createCanvas, loadImage } = await loadCanvasBackend();
	const renderer = new CanvasRenderer({ width, height, scale, createCanvas, loadImage });

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
