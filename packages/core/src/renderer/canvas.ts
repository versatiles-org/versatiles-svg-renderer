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
	IconStyle,
	LineStyle,
	RasterStyle,
	RasterTile,
	Renderer,
	RendererOptions,
	SymbolStyle,
} from './types.js';
import type { SpriteAtlas } from '../sources/sprite.js';
import { mapIconAnchor, mapTextAnchor } from './anchors.js';
import { LRUCache } from '../lru_cache.js';
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
// A Gaussian leaves soft, infinite tails; MapLibre's feather has a hard cutoff. The
// blurred layer's alpha is steepened (slope > 1, intercept < 0) to clip those tails, the
// same correction the SVG backend makes with feComponentTransfer.
const BLUR_ALPHA_SLOPE = 1.5;
const BLUR_ALPHA_INTERCEPT = -0.6;

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
	/**
	 * Where decoded images are kept, keyed by data URI. Pass one to share decoded tiles and
	 * sprite sheets between renders; without it, each renderer decodes into its own.
	 */
	images?: ImageCache;
}

/** Decoded images by data URI, such as an {@link LRUCache}. */
export interface ImageCache {
	getOrLoad(dataUri: string, load: () => Promise<Image>): Promise<Image>;
}

export class CanvasRenderer implements Renderer {
	public readonly width: number;

	public readonly height: number;

	public readonly scale: number;

	public readonly canvas: Canvas;

	public readonly ctx: SKRSContext2D;

	readonly #createCanvas: (width: number, height: number) => Canvas;

	readonly #loadImage: ((source: string) => Promise<Image>) | undefined;

	/** Whether the context was saved for the clip circle, to be restored by `finish`. */
	#clipped = false;

	/** Reused offscreen layer for effects that must not see what is already drawn. */
	#scratch: { canvas: Canvas; ctx: SKRSContext2D } | undefined;

	/** Decoded tile and sprite images, keyed by data URI: a tile may repeat within a layer. */
	readonly #images: ImageCache;

	public constructor(opt: CanvasRendererOptions) {
		this.width = opt.width;
		this.height = opt.height;
		this.scale = opt.scale ?? 1;
		this.canvas = opt.createCanvas(
			Math.round(this.width * this.scale),
			Math.round(this.height * this.scale),
		);
		this.#createCanvas = opt.createCanvas;
		this.#loadImage = opt.loadImage;
		this.#images = opt.images ?? new LRUCache<Image>(Infinity, () => 0);
		this.ctx = this.canvas.getContext('2d');
		// Draw in user units; the scale factor only changes how many device pixels each
		// unit covers.
		this.ctx.scale(this.scale, this.scale);
	}

	/**
	 * Restricts all later drawing to the globe's silhouette. The pipeline calls this
	 * before any layer is drawn, so the clip can be applied to the context directly (the
	 * SVG backend instead has to defer it to a `clipPath` at serialization time). Drawing
	 * methods save and restore around their own state, so this outer clip survives them;
	 * {@link finish} removes it.
	 */
	public setClipCircle(circle: ClipCircle): void {
		if (!this.#clipped) this.ctx.save();
		this.#clipped = true;
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
				this.#paint(this.ctx, style.translate, style.opacity, (ctx) => {
					ctx.fillStyle = color.hex;
					this.#trace(ctx, toSegments(feature.geometry), true);
					ctx.fill();
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
			this.#paint(this.ctx, style.translate, style.opacity, (ctx) => {
				ctx.strokeStyle = color.hex;
				ctx.lineWidth = FILL_OUTLINE_WIDTH_PX;
				// A polygon clipped to its tile has an outline without the clipped edges.
				if (feature.outline) {
					this.#trace(ctx, toSegments(feature.outline), false);
				} else {
					this.#trace(ctx, toSegments(feature.geometry), true);
				}
				ctx.stroke();
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
			const opacity = style.opacity * blurOpacity;

			const segments = feature.geometry.map((line) =>
				toSegment(style.offset === 0 ? line : offsetSegmentPoints(line, style.offset)),
			);
			// A translucent line is stroked part by part: MapLibre blends each separately, so
			// where parts overlap their opacity adds up. Opaque lines are chained first, so
			// joins are drawn between parts that share an endpoint.
			const translucent = opacity < 1 || color.alpha < 255;
			const stroke = (ctx: SKRSContext2D): void => {
				ctx.strokeStyle = color.hex;
				ctx.lineWidth = style.width;
				ctx.lineCap = style.cap;
				ctx.lineJoin = style.join;
				ctx.miterLimit = style.miterLimit;
				if (style.dasharray) ctx.setLineDash(style.dasharray.map((v) => v * style.width));
				if (translucent) {
					for (const segment of segments) {
						this.#trace(ctx, [segment], false);
						ctx.stroke();
					}
				} else {
					this.#trace(ctx, chainSegments(segments), false);
					ctx.stroke();
				}
			};

			if (style.blur <= 0) {
				this.#paint(this.ctx, style.translate, opacity, stroke);
				continue;
			}

			// Blurred lines are drawn one feature at a time in an offscreen layer: the alpha
			// curve that clips the Gaussian's tails has to see this feature alone. (The SVG
			// backend isolates per path, which for a blurred line is per part; a feature's own
			// parts rarely overlap, so the two stay close.)
			const stdDeviation = style.blur * BLUR_STD_FACTOR;
			const margin = style.width / 2 + 3 * stdDeviation + 2;
			this.#isolate(
				regionOf(segments, style.translate, margin),
				opacity,
				[BLUR_ALPHA_SLOPE, BLUR_ALPHA_INTERCEPT],
				(ctx) => {
					applyTranslate(ctx, style.translate);
					ctx.filter = `blur(${String(stdDeviation)}px)`;
					stroke(ctx);
				},
			);
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

			this.#paint(this.ctx, style.translate, style.opacity, (ctx) => {
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

		// A translucent raster layer is flattened first: its tiles overlap on purpose along
		// the seams (and the globe mesh draws a bleeding underlay beneath them), so applying
		// opacity per tile would let those overlaps show through.
		if (style.opacity < 1) {
			this.#isolate(
				{ x: 0, y: 0, width: this.width, height: this.height },
				style.opacity,
				undefined,
				(ctx) => {
					this.#paintRaster(ctx, tiles, images, style);
				},
			);
		} else {
			this.#paintRaster(this.ctx, tiles, images, style);
		}
	}

	#paintRaster(
		ctx: SKRSContext2D,
		tiles: RasterTile[],
		images: Map<string, Image>,
		style: RasterStyle,
	): void {
		ctx.save();
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

		this.#drawRasterMeshes(ctx, tiles, images);

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
	#drawRasterMeshes(ctx: SKRSContext2D, tiles: RasterTile[], images: Map<string, Image>): void {
		const meshes = tiles.flatMap((tile) => {
			const image = tile.triangles ? images.get(tile.dataUri) : undefined;
			return image && tile.triangles ? [{ image, triangles: tile.triangles }] : [];
		});

		for (const { image, triangles } of meshes) {
			for (const { source, target } of triangles) {
				if (!isOnTileBorder(source)) continue;
				this.#drawRasterTriangle(ctx, image, bleedAtTileBorder(source, target), target);
			}
		}
		for (const { image, triangles } of meshes) {
			for (const { source, target } of triangles) {
				this.#drawRasterTriangle(ctx, image, source, target);
			}
		}
	}

	#drawRasterTriangle(ctx: SKRSContext2D, image: Image, source: Triangle, target: Triangle): void {
		const matrix = affineFromTriangles(source, target);
		if (!matrix) return;
		const clip = growTriangle(target, RASTER_TRIANGLE_OVERLAP_PX);
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
		const loadImage = this.#loadImage;
		if (!loadImage) {
			throw new Error('CanvasRenderer: drawing images needs a `loadImage` in its options');
		}
		return this.#images.getOrLoad(dataUri, () => loadImage(dataUri));
	}

	public async drawIcons(
		_id: string,
		features: [Feature, IconStyle][],
		spriteAtlas: SpriteAtlas,
	): Promise<void> {
		if (features.length === 0) return;

		const drawable = features.filter(([, style]) => {
			const sprite = spriteAtlas.get(style.image);
			return style.opacity > 0 && sprite !== undefined;
		});
		if (drawable.length === 0) return;

		// Decode each sprite sheet once, up front, so the drawing itself stays synchronous
		// and keeps the features in order.
		const sheets = new Map<string, Image>();
		await Promise.all(
			[...new Set(drawable.map(([, style]) => spriteAtlas.get(style.image)!.sheetDataUri))].map(
				async (uri) => {
					sheets.set(uri, await this.#decode(uri));
				},
			),
		);

		for (const [feature, style] of drawable) {
			const sprite = spriteAtlas.get(style.image)!;
			const sheet = sheets.get(sprite.sheetDataUri);
			if (!sheet) continue;

			// The pipeline places each symbol: its feature is a single point.
			const point = feature.geometry[0]?.[0];
			if (!point) continue;

			const scale = style.size / sprite.pixelRatio;
			const width = sprite.width * scale;
			const height = sprite.height * scale;
			const [anchorX, anchorY] = mapIconAnchor(style.anchor, width, height);
			const [x, y] = roundPoint(
				point.x + style.offset[0] * style.size + anchorX,
				point.y + style.offset[1] * style.size + anchorY,
			);
			const box = {
				x: x / UNITS_PER_PX,
				y: y / UNITS_PER_PX,
				width,
				height,
			};
			// The SVG backend rotates about the point plus its offset, before the anchor is
			// applied; mirror that so both backends place a rotated icon identically.
			const [pivotX, pivotY] = roundPoint(
				point.x + style.offset[0] * style.size,
				point.y + style.offset[1] * style.size,
			);
			const pivot: [number, number] = [pivotX / UNITS_PER_PX, pivotY / UNITS_PER_PX];

			const blit = (ctx: SKRSContext2D): void => {
				ctx.save();
				if (style.rotate !== 0) {
					ctx.translate(pivot[0], pivot[1]);
					ctx.rotate((style.rotate * Math.PI) / 180);
					ctx.translate(-pivot[0], -pivot[1]);
				}
				ctx.drawImage(
					sheet,
					sprite.x,
					sprite.y,
					sprite.width,
					sprite.height,
					box.x,
					box.y,
					box.width,
					box.height,
				);
				ctx.restore();
			};

			if (!style.sdf) {
				this.#paint(this.ctx, [0, 0], style.opacity, blit);
				continue;
			}
			this.#drawSdfIcon(box, pivot, style, blit);
		}
	}

	/**
	 * Recolours an SDF sprite and gives it a halo. MapLibre treats the sprite's alpha as a
	 * signed distance field: everything at or above 0.75 is inside the glyph. So the mask is
	 * thresholded there, dilated by the halo width, and the two regions are filled with the
	 * icon and halo colours — the same result the SVG backend gets from feComponentTransfer,
	 * feMorphology and feFlood, computed directly on the pixels.
	 */
	#drawSdfIcon(
		box: Region,
		pivot: [number, number],
		style: IconStyle,
		blit: (ctx: SKRSContext2D) => void,
	): void {
		const color = new Color(style.color);
		const haloColor = new Color(style.haloColor);
		const halo = style.haloWidth > 0 && haloColor.alpha > 0 ? Math.round(style.haloWidth) : 0;

		// A rotated icon sweeps out at most its diagonal; add the halo on top.
		const reach = style.rotate !== 0 ? Math.hypot(box.width, box.height) : 0;
		const margin = halo + 1 + reach;
		const region: Region = {
			x: Math.min(box.x, pivot[0]) - margin,
			y: Math.min(box.y, pivot[1]) - margin,
			width: box.width + 2 * margin + Math.abs(box.x - pivot[0]),
			height: box.height + 2 * margin + Math.abs(box.y - pivot[1]),
		};

		const haloPixels = Math.round(halo * this.scale);
		this.#isolateRaw(region, style.opacity, blit, (data, width, height) => {
			// MapLibre's SDF edge: alpha >= 0.75 is inside the glyph.
			const inside = new Uint8Array(width * height);
			for (let i = 0; i < inside.length; i++) inside[i] = data[i * 4 + 3]! >= 191 ? 1 : 0;
			const dilated = haloPixels > 0 ? dilate(inside, width, height, haloPixels) : inside;

			for (let i = 0; i < inside.length; i++) {
				const paint = inside[i] ? color : dilated[i] ? haloColor : undefined;
				const at = i * 4;
				if (!paint) {
					data[at + 3] = 0;
					continue;
				}
				const [r, g, b] = paint.rgbBytes;
				data[at] = r;
				data[at + 1] = g;
				data[at + 2] = b;
				data[at + 3] = paint.alpha;
			}
		});
	}

	public drawLabels(_id: string, features: [Feature, SymbolStyle][]): void {
		if (features.length === 0) return;

		for (const [feature, style] of features) {
			if (style.opacity <= 0 || !style.text) continue;
			const color = new Color(style.color);
			if (color.alpha <= 0) continue;

			// The pipeline places each symbol: its feature is a single point.
			const point = feature.geometry[0]?.[0];
			if (!point) continue;
			const [px, py] = roundPoint(point.x, point.y);
			const x = px / UNITS_PER_PX;
			const y = py / UNITS_PER_PX;
			const [dx, dy] = roundPoint(style.offset[0] * style.size, style.offset[1] * style.size);

			const [align, baseline] = mapTextAnchor(style.anchor);

			this.#paint(this.ctx, [0, 0], style.opacity, (ctx) => {
				if (style.rotate !== 0) {
					ctx.translate(x, y);
					ctx.rotate((style.rotate * Math.PI) / 180);
					ctx.translate(-x, -y);
				}
				ctx.font = `${String(roundToTenths(style.size))}px ${style.font.join(', ')}, Helvetica, Arial, sans-serif`;
				ctx.textAlign = CANVAS_TEXT_ALIGN[align];
				ctx.textBaseline = CANVAS_TEXT_BASELINE[baseline];

				const haloColor = new Color(style.haloColor);
				// Stroke first, then fill: the same order `paint-order="stroke fill"` gives the
				// SVG backend, so the halo stays behind the glyph.
				if (style.haloWidth > 0 && haloColor.alpha > 0) {
					ctx.strokeStyle = haloColor.hex;
					ctx.lineWidth = roundToTenths(style.haloWidth);
					ctx.lineJoin = 'round';
					ctx.strokeText(style.text, x + dx / UNITS_PER_PX, y + dy / UNITS_PER_PX);
				}
				ctx.fillStyle = color.hex;
				ctx.fillText(style.text, x + dx / UNITS_PER_PX, y + dy / UNITS_PER_PX);
			});
		}
	}

	/**
	 * Leaves the context as a caller expects it: in its default state, apart from the
	 * scale to device pixels.
	 */
	public finish(): void {
		if (this.#clipped) this.ctx.restore();
		this.#clipped = false;
	}

	public toBuffer(): Buffer {
		return this.canvas.toBuffer('image/png');
	}

	/** Runs `draw` with the layer's translate and opacity applied, and nothing leaking out. */
	#paint(
		ctx: SKRSContext2D,
		translate: [number, number],
		opacity: number,
		draw: (ctx: SKRSContext2D) => void,
	): void {
		ctx.save();
		applyTranslate(ctx, translate);
		if (opacity < 1) ctx.globalAlpha = opacity;
		draw(ctx);
		ctx.restore();
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
	#isolate(
		region: Region,
		opacity: number,
		alphaCurve: [number, number] | undefined,
		draw: (ctx: SKRSContext2D) => void,
	): void {
		this.#isolateRaw(
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
	 * The general form of {@link #isolate}: `pixels` may rewrite the layer's device pixels
	 * however it likes (straight, un-premultiplied RGBA) before it is composited.
	 */
	#isolateRaw(
		region: Region,
		opacity: number,
		draw: (ctx: SKRSContext2D) => void,
		pixels?: (data: Uint8ClampedArray, width: number, height: number) => void,
	): void {
		const scratch = this.#scratchLayer();
		// The device-pixel window of the region, clamped to the canvas.
		const x = Math.max(0, Math.floor(region.x * this.scale));
		const y = Math.max(0, Math.floor(region.y * this.scale));
		const width =
			Math.min(this.canvas.width, Math.ceil((region.x + region.width) * this.scale)) - x;
		const height =
			Math.min(this.canvas.height, Math.ceil((region.y + region.height) * this.scale)) - y;
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

		const { ctx } = this;
		ctx.save();
		// Composite in device pixels; any clip set earlier still applies.
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		if (opacity < 1) ctx.globalAlpha = opacity;
		ctx.drawImage(scratch.canvas, x, y, width, height, x, y, width, height);
		ctx.restore();
	}

	#scratchLayer(): { canvas: Canvas; ctx: SKRSContext2D } {
		if (!this.#scratch) {
			const canvas = this.#createCanvas(this.canvas.width, this.canvas.height);
			const ctx = canvas.getContext('2d');
			ctx.scale(this.scale, this.scale);
			this.#scratch = { canvas, ctx };
		}
		return this.#scratch;
	}

	/** Starts a new path and traces every segment into it. */
	#trace(ctx: SKRSContext2D, segments: Segment[], close: boolean): void {
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

const CANVAS_TEXT_ALIGN = {
	start: 'start',
	middle: 'center',
	end: 'end',
} as const satisfies Record<string, CanvasTextAlign>;

const CANVAS_TEXT_BASELINE = {
	central: 'middle',
	'text-before-edge': 'top',
	'text-after-edge': 'bottom',
} as const satisfies Record<string, CanvasTextBaseline>;

/**
 * Grows a binary mask by `radius` pixels, the way feMorphology's dilate does: with a
 * rectangular structuring element, applied separably so the cost is O(pixels x radius)
 * rather than O(pixels x radius^2).
 */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
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

function roundToTenths(v: number): number {
	return Math.round(v * UNITS_PER_PX) / UNITS_PER_PX;
}

/** A rectangle in user units. */
interface Region {
	x: number;
	y: number;
	width: number;
	height: number;
}

function applyTranslate(ctx: SKRSContext2D, translate: [number, number]): void {
	if (translate[0] === 0 && translate[1] === 0) return;
	const [x, y] = roundPoint(translate[0], translate[1]);
	ctx.translate(x / UNITS_PER_PX, y / UNITS_PER_PX);
}

/** The bounding box of `segments`, shifted by `translate` and grown by `margin`. */
function regionOf(segments: Segment[], translate: [number, number], margin: number): Region {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const segment of segments) {
		for (const [x, y] of segment) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	if (minX > maxX) return { x: 0, y: 0, width: 0, height: 0 };
	return {
		x: minX / UNITS_PER_PX + translate[0] - margin,
		y: minY / UNITS_PER_PX + translate[1] - margin,
		width: (maxX - minX) / UNITS_PER_PX + 2 * margin,
		height: (maxY - minY) / UNITS_PER_PX + 2 * margin,
	};
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
