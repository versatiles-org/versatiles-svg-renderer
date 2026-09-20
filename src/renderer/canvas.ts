import type { Canvas, Image, SKRSContext2D } from '@napi-rs/canvas';
import type { Feature } from '../geometry.js';
import type { ClipCircle } from '../projection.js';
import { Color } from './color.js';
import type { Segment } from './svg_path.js';
import { chainSegments, offsetSegmentPoints } from './svg_path.js';
import type {
	BackgroundStyle,
	CircleStyle,
	FillStyle,
	LineStyle,
	RasterStyle,
	RasterTile,
	Renderer,
	RendererOptions,
} from './types.js';
import {
	affineFromTriangles,
	bleedAtTileBorder,
	growTriangle,
	isOnTileBorder,
	RASTER_TILE_UNITS,
	RASTER_TRIANGLE_OVERLAP_PX,
	type Triangle,
} from './raster_mesh.js';

// These mirror the SVG backend's constants but are deliberately *separate*: they are
// calibrated per backend against MapLibre in the e2e comparison, and Skia's rasterizer
// is not Chromium's. Tuning one backend must not silently move the other.
const FILL_OUTLINE_WIDTH_PX = 0.5;
const BLUR_STD_FACTOR = 0.15;
const BLUR_OPACITY_K = 1.5;

/**
 * Geometry is snapped to tenths of a pixel, exactly as the SVG backend does when it
 * serializes coordinates. It costs nothing visible and keeps both backends working from
 * identical geometry, so the SVG-vs-PNG drift measured in the e2e report reflects real
 * rasterizer differences rather than rounding.
 */
const UNITS_PER_PX = 10;

export interface CanvasRendererOptions extends RendererOptions {
	/**
	 * Device pixel ratio. The bitmap is `width * scale` by `height * scale` pixels while
	 * the map is laid out in `width` by `height` user units, so strokes and symbols keep
	 * their size and simply gain detail.
	 */
	scale?: number;
	/**
	 * The canvas factory from `@napi-rs/canvas`. It is injected rather than imported so
	 * this module carries no runtime dependency on the native backend — the caller loads
	 * it (and reports a helpful error if it is missing).
	 */
	createCanvas: (width: number, height: number) => Canvas;
	/**
	 * `loadImage` from the same backend, used to decode the data URIs that carry raster
	 * tiles and sprite sheets. Required only for styles that use them.
	 */
	loadImage?: (source: string) => Promise<Image>;
}

export class CanvasRenderer implements Renderer {
	public readonly width: number;

	public readonly height: number;

	public readonly scale: number;

	public readonly canvas: Canvas;

	public readonly ctx: SKRSContext2D;

	readonly #loadImage: ((source: string) => Promise<Image>) | undefined;

	/** Decoded tile and sprite images, keyed by data URI: a tile may repeat within a layer. */
	readonly #images = new Map<string, Image>();

	public constructor(opt: CanvasRendererOptions) {
		this.width = opt.width;
		this.height = opt.height;
		this.scale = opt.scale ?? 1;
		this.canvas = opt.createCanvas(
			Math.round(this.width * this.scale),
			Math.round(this.height * this.scale),
		);
		this.#loadImage = opt.loadImage;
		this.ctx = this.canvas.getContext('2d');
		// Draw in user units; the scale factor only changes how many device pixels each
		// unit covers.
		this.ctx.scale(this.scale, this.scale);
	}

	/**
	 * Restricts all later drawing to the globe's silhouette. The pipeline calls this
	 * before any layer is drawn, so the clip can be applied to the context directly (the
	 * SVG backend instead has to defer it to a `clipPath` at serialization time). Drawing
	 * methods save and restore around their own state, so this outer clip survives them.
	 */
	public setClipCircle(circle: ClipCircle): void {
		this.ctx.beginPath();
		this.ctx.arc(circle.x, circle.y, circle.radius, 0, 2 * Math.PI);
		this.ctx.clip();
	}

	public drawBackgroundFill(style: BackgroundStyle): void {
		// Every background layer paints over what is below it, like any other layer. (A
		// transparent one, e.g. an empty "slot" layer, must not erase an earlier background.)
		const color = new Color(style.color);
		color.alpha *= style.opacity;
		if (color.alpha <= 0) return;
		this.ctx.save();
		this.ctx.fillStyle = color.hex;
		this.ctx.fillRect(-1, -1, this.width + 2, this.height + 2);
		this.ctx.restore();
	}

	public drawPolygons(_id: string, features: [Feature, FillStyle][]): void {
		if (features.length === 0) return;

		// Unlike the SVG backend there is nothing to merge: canvas blends every draw call
		// separately, which is exactly what MapLibre does per feature. Fills and antialias
		// outlines are still collected in one pass and drawn in two, because MapLibre draws
		// every fill first and every outline after, so a lower feature's border composites
		// on top of a later overlapping fill.
		const outlines: { feature: Feature; style: FillStyle; color: Color }[] = [];

		for (const [feature, style] of features) {
			if (style.opacity <= 0) continue;

			const color = new Color(style.color);
			const translucent = style.opacity < 1 || color.alpha < 255;

			if (color.alpha > 0) {
				this.#paint(style.translate, style.opacity, () => {
					this.ctx.fillStyle = color.hex;
					this.#trace(toSegments(feature.geometry), true);
					this.ctx.fill();
				});
			}

			// fill-antialias outline, in fill-outline-color or else the fill color. For an
			// opaque fill MapLibre's outline *is* its edge antialiasing, which the rasterizer
			// already provides, so it is only drawn where it shows: a distinct
			// fill-outline-color (choropleths), or a translucent fill where MapLibre draws
			// the outline over the fill's edge.
			if (style.antialias && (style.outlineColor !== undefined || translucent)) {
				const outlineColor =
					style.outlineColor !== undefined ? new Color(style.outlineColor) : color;
				if (outlineColor.alpha > 0) outlines.push({ feature, style, color: outlineColor });
			}
		}

		for (const { feature, style, color } of outlines) {
			this.#paint(style.translate, style.opacity, () => {
				this.ctx.strokeStyle = color.hex;
				this.ctx.lineWidth = FILL_OUTLINE_WIDTH_PX;
				// A polygon clipped to its tile has an outline without the clipped edges.
				if (feature.outline) {
					this.#trace(toSegments(feature.outline), false);
				} else {
					this.#trace(toSegments(feature.geometry), true);
				}
				this.ctx.stroke();
			});
		}
	}

	public drawLineStrings(_id: string, features: [Feature, LineStyle][]): void {
		if (features.length === 0) return;

		for (const [feature, style] of features) {
			if (style.opacity <= 0) continue;
			const color = new Color(style.color);
			if (style.width <= 0 || color.alpha <= 0) continue;

			// MapLibre's line-blur fades the line as the blur approaches its width (the
			// feather eats into the opaque core); a Gaussian conserves total ink, so the fade
			// is approximated with an extra opacity factor.
			const blurOpacity =
				style.blur > 0 ? style.width / (style.width + BLUR_OPACITY_K * style.blur) : 1;

			this.#paint(style.translate, style.opacity * blurOpacity, () => {
				const { ctx } = this;
				ctx.strokeStyle = color.hex;
				ctx.lineWidth = style.width;
				ctx.lineCap = style.cap;
				ctx.lineJoin = style.join;
				ctx.miterLimit = style.miterLimit;
				if (style.dasharray) {
					ctx.setLineDash(style.dasharray.map((v) => v * style.width));
				}
				if (style.blur > 0) {
					// A plain Gaussian, without the alpha steepening the SVG backend applies to
					// clip its tails: that needs the layer to be isolated from what is already
					// drawn, which arrives with layer compositing.
					ctx.filter = `blur(${String(style.blur * BLUR_STD_FACTOR)}px)`;
				}

				const segments = feature.geometry.map((line) =>
					toSegment(style.offset === 0 ? line : offsetSegmentPoints(line, style.offset)),
				);
				// A translucent line is stroked part by part: MapLibre blends each separately,
				// so where parts overlap their opacity adds up. Opaque lines are chained first,
				// so joins are drawn between parts that share an endpoint.
				const translucent = style.opacity * blurOpacity < 1 || color.alpha < 255;
				if (translucent) {
					for (const segment of segments) {
						this.#trace([segment], false);
						ctx.stroke();
					}
				} else {
					this.#trace(chainSegments(segments), false);
					ctx.stroke();
				}
			});
		}
	}

	public drawCircles(_id: string, features: [Feature, CircleStyle][]): void {
		if (features.length === 0) return;

		for (const [feature, style] of features) {
			if (style.opacity <= 0) continue;
			const color = new Color(style.color);
			if (style.radius <= 0 || color.alpha <= 0) continue;

			const strokeColor = new Color(style.strokeColor);
			const hasStroke = style.strokeWidth > 0;
			// MapLibre draws the stroke *outside* the radius (fill to `radius`, stroke over
			// `[radius, radius + strokeWidth]`), whereas a canvas stroke is centered on the
			// path. Grow the drawn radius by half the stroke width so the fill still reaches
			// `radius` and the stroke lands on the same ring.
			const radius = hasStroke ? style.radius + style.strokeWidth / 2 : style.radius;

			this.#paint(style.translate, style.opacity, () => {
				const { ctx } = this;
				ctx.fillStyle = color.hex;
				for (const ring of feature.geometry) {
					const point = ring[0];
					if (!point) continue;
					const [x, y] = roundPoint(point.x, point.y);
					ctx.beginPath();
					ctx.arc(x / UNITS_PER_PX, y / UNITS_PER_PX, radius, 0, 2 * Math.PI);
					ctx.fill();
					if (hasStroke && strokeColor.alpha > 0) {
						ctx.strokeStyle = strokeColor.hex;
						ctx.lineWidth = style.strokeWidth;
						ctx.stroke();
					}
				}
			});
		}
	}

	public async drawRasterTiles(
		_id: string,
		tiles: RasterTile[],
		style: RasterStyle,
	): Promise<void> {
		if (tiles.length === 0 || style.opacity <= 0) return;

		// Decode every distinct tile image once. `loadImage` is asynchronous on purpose:
		// setting `Image.src` from a buffer reports `complete === true` straight away, but
		// the pixels only land on the next tick, so drawing it right away paints nothing.
		const images = new Map<string, Image>();
		await Promise.all(
			[...new Set(tiles.map((tile) => tile.dataUri))].map(async (uri) => {
				images.set(uri, await this.#decode(uri));
			}),
		);

		const { ctx } = this;
		ctx.save();
		if (style.opacity < 1) ctx.globalAlpha = style.opacity;
		// The same colour adjustments the SVG backend expresses as CSS filter functions.
		const filters: string[] = [];
		if (style.hueRotate !== 0) filters.push(`hue-rotate(${String(style.hueRotate)}deg)`);
		if (style.saturation !== 0) filters.push(`saturate(${String(style.saturation + 1)})`);
		if (style.contrast !== 0) filters.push(`contrast(${String(style.contrast + 1)})`);
		if (style.brightnessMin !== 0 || style.brightnessMax !== 1) {
			filters.push(`brightness(${String((style.brightnessMin + style.brightnessMax) / 2)})`);
		}
		if (filters.length > 0) ctx.filter = filters.join(' ');
		if (style.resampling === 'nearest') ctx.imageSmoothingEnabled = false;

		this.#drawRasterMeshes(tiles, images);

		for (const tile of tiles) {
			if (tile.triangles) continue;
			const image = images.get(tile.dataUri);
			if (!image) continue;
			// A slight overlap prevents sub-pixel gaps between neighbouring tiles.
			const overlap = Math.min(tile.width, tile.height) / 10000;
			ctx.drawImage(
				image,
				tile.x - overlap,
				tile.y - overlap,
				tile.width + overlap * 2,
				tile.height + overlap * 2,
			);
		}

		ctx.restore();
	}

	/**
	 * Draws the tiles given as triangle meshes (globe projection). Each triangle shows its
	 * tile image through the affine transform mapping its three source corners onto its
	 * three screen corners, clipped to the triangle.
	 *
	 * Seams: every clip triangle is grown by RASTER_TRIANGLE_OVERLAP_PX, so it overlaps its
	 * neighbour with (almost) the same pixels. At tile borders that is not enough, as both
	 * images end on the same line and their antialiased edges let the background show
	 * through — so the border triangles are drawn first as an underlay with their image
	 * reaching past the border, and the real triangles are drawn exactly on top.
	 */
	#drawRasterMeshes(tiles: RasterTile[], images: Map<string, Image>): void {
		const meshes = tiles.flatMap((tile) => {
			const image = tile.triangles ? images.get(tile.dataUri) : undefined;
			return image && tile.triangles ? [{ image, triangles: tile.triangles }] : [];
		});

		for (const { image, triangles } of meshes) {
			for (const { source, target } of triangles) {
				if (!isOnTileBorder(source)) continue;
				this.#drawRasterTriangle(image, bleedAtTileBorder(source, target), target);
			}
		}
		for (const { image, triangles } of meshes) {
			for (const { source, target } of triangles) {
				this.#drawRasterTriangle(image, source, target);
			}
		}
	}

	#drawRasterTriangle(image: Image, source: Triangle, target: Triangle): void {
		const matrix = affineFromTriangles(source, target);
		if (!matrix) return;
		const clip = growTriangle(target, RASTER_TRIANGLE_OVERLAP_PX);
		const { ctx } = this;
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(clip[0][0], clip[0][1]);
		ctx.lineTo(clip[1][0], clip[1][1]);
		ctx.lineTo(clip[2][0], clip[2][1]);
		ctx.closePath();
		ctx.clip();
		// The affine maps the tile's source square (RASTER_TILE_UNITS on a side) onto the
		// screen, so the image is drawn into exactly that square.
		ctx.transform(...matrix);
		ctx.drawImage(image, 0, 0, RASTER_TILE_UNITS, RASTER_TILE_UNITS);
		ctx.restore();
	}

	async #decode(dataUri: string): Promise<Image> {
		const cached = this.#images.get(dataUri);
		if (cached) return cached;
		if (!this.#loadImage) {
			throw new Error('CanvasRenderer: drawing images needs a `loadImage` in its options');
		}
		const image = await this.#loadImage(dataUri);
		this.#images.set(dataUri, image);
		return image;
	}

	// Still to come. They throw rather than no-op so a style that needs them fails loudly
	// instead of silently rendering without its icons or labels. (Parameters are omitted:
	// TypeScript still satisfies the wider `Renderer` signatures.)
	public drawIcons(): void {
		throw new Error('CanvasRenderer: icons are not implemented yet');
	}

	public drawLabels(): void {
		throw new Error('CanvasRenderer: labels are not implemented yet');
	}

	public toBuffer(): Buffer {
		return this.canvas.toBuffer('image/png');
	}

	/** Runs `draw` with the layer's translate and opacity applied, and nothing leaking out. */
	#paint(translate: [number, number], opacity: number, draw: () => void): void {
		this.ctx.save();
		if (translate[0] !== 0 || translate[1] !== 0) {
			const [x, y] = roundPoint(translate[0], translate[1]);
			this.ctx.translate(x / UNITS_PER_PX, y / UNITS_PER_PX);
		}
		if (opacity < 1) this.ctx.globalAlpha = opacity;
		draw();
		this.ctx.restore();
	}

	/** Starts a new path and traces every segment into it. */
	#trace(segments: Segment[], close: boolean): void {
		const { ctx } = this;
		ctx.beginPath();
		for (const segment of segments) {
			const first = segment[0];
			if (!first) continue;
			ctx.moveTo(first[0] / UNITS_PER_PX, first[1] / UNITS_PER_PX);
			for (let i = 1; i < segment.length; i++) {
				const point = segment[i]!;
				ctx.lineTo(point[0] / UNITS_PER_PX, point[1] / UNITS_PER_PX);
			}
			if (close) ctx.closePath();
		}
	}
}

function roundPoint(x: number, y: number): [number, number] {
	return [Math.round(x * UNITS_PER_PX), Math.round(y * UNITS_PER_PX)];
}

function toSegment(points: { x: number; y: number }[]): Segment {
	return points.map((p) => roundPoint(p.x, p.y));
}

function toSegments(rings: { x: number; y: number }[][]): Segment[] {
	return rings.map(toSegment);
}
