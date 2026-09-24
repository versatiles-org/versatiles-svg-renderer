/**
 * Sprite images repeated over an area, for `*-pattern` fills: tiled copy by copy, or as a
 * canvas pattern, each cropped from its sprite sheet once.
 */
import type { Canvas, CanvasPattern, Image, SKRSContext2D } from '@napi-rs/canvas';
import type { FillPattern } from '../../types.js';

/** The largest offscreen image a turned pattern is drawn from, in pixels (32 MB). */
const MAX_PATTERN_IMAGE_PIXELS = 8_000_000;

export class CanvasPatterns {
	readonly #ctx: SKRSContext2D;

	readonly #createCanvas: (width: number, height: number) => Canvas;

	readonly #scale: number;

	readonly #decode: (dataUri: string) => Promise<Image>;

	/** Canvas patterns by sprite image (name and sheet), each cropped from its sheet once. */
	readonly #patterns = new Map<string, CanvasPattern>();

	public constructor(
		ctx: SKRSContext2D,
		createCanvas: (width: number, height: number) => Canvas,
		scale: number,
		decode: (dataUri: string) => Promise<Image>,
	) {
		this.#ctx = ctx;
		this.#createCanvas = createCanvas;
		this.#scale = scale;
		this.#decode = decode;
	}

	/**
	 * Covers `box` (in user units) with copies of the sprite image of `pattern`, at its
	 * display size, with a copy's corner at `pattern.origin`: the area is clipped by the
	 * caller. Copies are drawn one by one, because a canvas pattern of `@napi-rs/canvas`
	 * always resamples its image, which blurs thin hatching; `drawImage` does not.
	 */
	public tile(
		ctx: SKRSContext2D,
		pattern: FillPattern,
		sheet: Image,
		box: [number, number, number, number],
	): void {
		const { sprite } = pattern;
		const width = (sprite.width / sprite.pixelRatio) * (pattern.scale ?? 1);
		const height = (sprite.height / sprite.pixelRatio) * (pattern.scale ?? 1);
		const angle = pattern.angle ?? 0;
		if (angle !== 0) {
			// Turned with the map: the copies are drawn crisply into an offscreen image of the
			// area, in the pattern's own frame, which is then drawn turned, in one piece.
			// (Turned copies drawn one by one would show seams, and a canvas pattern blurs, see
			// `fill`.)
			const radians = (angle * Math.PI) / 180;
			const cos = Math.cos(radians);
			const sin = Math.sin(radians);
			const corners = [
				[box[0], box[1]],
				[box[2], box[1]],
				[box[2], box[3]],
				[box[0], box[3]],
			].map(([x, y]) => {
				const dx = x! - pattern.origin[0];
				const dy = y! - pattern.origin[1];
				return [dx * cos + dy * sin, -dx * sin + dy * cos] as const;
			});
			const i0 = Math.floor(Math.min(...corners.map(([u]) => u)) / width);
			const i1 = Math.ceil(Math.max(...corners.map(([u]) => u)) / width);
			const j0 = Math.floor(Math.min(...corners.map(([, v]) => v)) / height);
			const j1 = Math.ceil(Math.max(...corners.map(([, v]) => v)) / height);
			const imageWidth = Math.ceil((i1 - i0) * width * this.#scale);
			const imageHeight = Math.ceil((j1 - j0) * height * this.#scale);
			ctx.save();
			ctx.translate(pattern.origin[0], pattern.origin[1]);
			ctx.rotate(radians);
			if (imageWidth * imageHeight <= MAX_PATTERN_IMAGE_PIXELS) {
				const image = this.#createCanvas(imageWidth, imageHeight);
				const tiles = image.getContext('2d');
				tiles.scale(this.#scale, this.#scale);
				for (let j = 0; j < j1 - j0; j++) {
					for (let i = 0; i < i1 - i0; i++) {
						tiles.drawImage(
							sheet,
							sprite.x,
							sprite.y,
							sprite.width,
							sprite.height,
							i * width,
							j * height,
							width,
							height,
						);
					}
				}
				ctx.drawImage(
					image,
					i0 * width,
					j0 * height,
					imageWidth / this.#scale,
					imageHeight / this.#scale,
				);
			} else {
				// A huge area: a canvas pattern, blurred a little, instead of a huge image.
				const fill = this.#patterns.get(`${pattern.name}\0${sprite.sheetDataUri}`);
				if (fill) {
					const scale = (pattern.scale ?? 1) / sprite.pixelRatio;
					fill.setTransform({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
					ctx.fillStyle = fill;
					ctx.fillRect(i0 * width, j0 * height, (i1 - i0) * width, (j1 - j0) * height);
				}
			}
			ctx.restore();
			return;
		}
		// The copies' corners, on whole device pixels so that neighbours meet without a seam.
		const snap = (value: number): number => Math.round(value * this.#scale) / this.#scale;
		const x0 = snap(box[0] - mod(box[0] - pattern.origin[0], width));
		const y0 = snap(box[1] - mod(box[1] - pattern.origin[1], height));
		for (let y = y0; y < box[3]; y = snap(y + height)) {
			for (let x = x0; x < box[2]; x = snap(x + width)) {
				ctx.drawImage(sheet, sprite.x, sprite.y, sprite.width, sprite.height, x, y, width, height);
			}
		}
	}

	/**
	 * A canvas pattern of `pattern`, for the outline of a pattern fill: its slight blur
	 * does not show on a 1 px line (see {@link CanvasPatterns.tile}).
	 */
	public async fill(pattern: FillPattern): Promise<CanvasPattern> {
		const { sprite } = pattern;
		const key = `${pattern.name}\0${sprite.sheetDataUri}`;
		let fill = this.#patterns.get(key);
		if (!fill) {
			const sheet = await this.#decode(sprite.sheetDataUri);
			const image = this.#createCanvas(sprite.width, sprite.height);
			image
				.getContext('2d')
				.drawImage(
					sheet,
					sprite.x,
					sprite.y,
					sprite.width,
					sprite.height,
					0,
					0,
					sprite.width,
					sprite.height,
				);
			fill = this.#ctx.createPattern(image, 'repeat');
			this.#patterns.set(key, fill);
		}
		const scale = (pattern.scale ?? 1) / sprite.pixelRatio;
		// Only the origin's position within one copy matters; keeping it small keeps it precise.
		const e = mod(pattern.origin[0], sprite.width * scale);
		const f = mod(pattern.origin[1], sprite.height * scale);
		fill.setTransform({ a: scale, b: 0, c: 0, d: scale, e, f });
		return fill;
	}
}

/** `value` modulo `period`, always in `[0, period)`. */
function mod(value: number, period: number): number {
	return ((value % period) + period) % period;
}
