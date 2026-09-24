/**
 * Offscreen drawing for effects that must see only what they draw: a layer the size of the
 * canvas, reused, from which a region is composited back.
 */
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';

/** A rectangle in user units. */
export interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

export class Offscreen {
	readonly #canvas: Canvas;

	readonly #ctx: SKRSContext2D;

	readonly #createCanvas: (width: number, height: number) => Canvas;

	readonly #scale: number;

	/** Reused offscreen layer for effects that must not see what is already drawn. */
	#scratch: { canvas: Canvas; ctx: SKRSContext2D } | undefined;

	/** Composites onto `canvas`, drawn with `ctx`, which is scaled by `scale`. */
	public constructor(
		canvas: Canvas,
		ctx: SKRSContext2D,
		createCanvas: (width: number, height: number) => Canvas,
		scale: number,
	) {
		this.#canvas = canvas;
		this.#ctx = ctx;
		this.#createCanvas = createCanvas;
		this.#scale = scale;
	}

	/**
	 * Draws into an offscreen layer and composites the result back at `opacity`, so an
	 * effect sees only what `draw` puts there. Two things need it: the alpha curve that
	 * clips a blur's Gaussian tails, which would otherwise rewrite every pixel underneath,
	 * and a translucent raster layer, whose tiles deliberately overlap along their seams
	 * and so must be flattened before the layer's opacity is applied.
	 *
	 * Only `region` (in user units) is cleared, transformed and copied, so the cost follows
	 * the size of what is actually drawn rather than the size of the map.
	 */
	public isolate(
		region: Region,
		opacity: number,
		alphaCurve: [number, number] | undefined,
		draw: (ctx: SKRSContext2D) => void,
	): void {
		this.isolateRaw(
			region,
			opacity,
			draw,
			alphaCurve &&
				((data): void => {
					const [slope, intercept] = alphaCurve;
					for (let i = 3; i < data.length; i += 4) {
						const alpha = data[i]! * slope + intercept * 255;
						data[i] = alpha <= 0 ? 0 : alpha >= 255 ? 255 : Math.round(alpha);
					}
				}),
		);
	}

	/**
	 * The general form of {@link Offscreen.isolate}: `pixels` may rewrite the layer's device
	 * pixels however it likes (straight, un-premultiplied RGBA) before it is composited.
	 */
	public isolateRaw(
		region: Region,
		opacity: number,
		draw: (ctx: SKRSContext2D) => void,
		pixels?: (data: Uint8ClampedArray, width: number, height: number) => void,
	): void {
		const scratch = this.#scratchLayer();
		// The device-pixel window of the region, clamped to the canvas.
		const x = Math.max(0, Math.floor(region.x * this.#scale));
		const y = Math.max(0, Math.floor(region.y * this.#scale));
		const width =
			Math.min(this.#canvas.width, Math.ceil((region.x + region.width) * this.#scale)) - x;
		const height =
			Math.min(this.#canvas.height, Math.ceil((region.y + region.height) * this.#scale)) - y;
		if (width <= 0 || height <= 0) return;

		scratch.ctx.save();
		scratch.ctx.setTransform(1, 0, 0, 1, 0, 0);
		scratch.ctx.clearRect(x, y, width, height);
		scratch.ctx.restore();

		scratch.ctx.save();
		draw(scratch.ctx);
		scratch.ctx.restore();

		if (pixels) {
			// getImageData/putImageData work in device pixels and in straight (un-premultiplied)
			// alpha, which is what an SVG filter primitive operates on too.
			const image = scratch.ctx.getImageData(x, y, width, height);
			pixels(image.data, width, height);
			scratch.ctx.putImageData(image, x, y);
		}

		const ctx = this.#ctx;
		ctx.save();
		// Composite in device pixels; any clip set earlier still applies.
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		if (opacity < 1) ctx.globalAlpha = opacity;
		ctx.drawImage(scratch.canvas, x, y, width, height, x, y, width, height);
		ctx.restore();
	}

	#scratchLayer(): { canvas: Canvas; ctx: SKRSContext2D } {
		if (!this.#scratch) {
			const canvas = this.#createCanvas(this.#canvas.width, this.#canvas.height);
			const ctx = canvas.getContext('2d');
			ctx.scale(this.#scale, this.#scale);
			this.#scratch = { canvas, ctx };
		}
		return this.#scratch;
	}
}

/**
 * Grows a binary mask by `radius` pixels, the way feMorphology's dilate does: with a
 * rectangular structuring element, applied separably so the cost is O(pixels x radius)
 * rather than O(pixels x radius^2).
 */
export function dilate(
	mask: Uint8Array,
	width: number,
	height: number,
	radius: number,
): Uint8Array {
	const pass = (source: Uint8Array, horizontal: boolean): Uint8Array => {
		const out = new Uint8Array(source.length);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				let on = 0;
				for (let d = -radius; d <= radius && !on; d++) {
					const sx = horizontal ? x + d : x;
					const sy = horizontal ? y : y + d;
					if (sx >= 0 && sx < width && sy >= 0 && sy < height && source[sy * width + sx]) on = 1;
				}
				out[y * width + x] = on;
			}
		}
		return out;
	};
	return pass(pass(mask, true), false);
}
