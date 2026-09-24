import type { Canvas, CanvasPattern, Image, SKRSContext2D } from '@napi-rs/canvas';
import type { Feature } from '../../geometry.js';
import type { ClipCircle } from '../../projection.js';
import { Color } from '../color.js';
import {
	chainSegments,
	iconQuads,
	JUSTIFY_ANCHOR,
	letterSpacingShift,
	linePatternStrips,
	mapTextAnchor,
	quadsBox,
	type Segment,
	strokeLines,
} from '../../layout/index.js';
import type {
	BackgroundStyle,
	CircleStyle,
	FillPattern,
	FillStyle,
	GlyphPlacement,
	IconStyle,
	LinePattern,
	PlacedGlyph,
	LineStyle,
	RasterStyle,
	RasterTile,
	Renderer,
	RendererOptions,
	SymbolStyle,
} from '../../types.js';
import type { SpriteAtlas } from '../../sources/index.js';
import { circleGradient, circleShape } from '../circle.js';
import { dilate, Offscreen, type Region } from './offscreen.js';
import { CanvasPatterns } from './patterns.js';
import { LRUCache } from '../../lru_cache.js';
import {
	affineFromTriangles,
	growTriangle,
	meshTriangles,
	RASTER_TILE_UNITS,
	RASTER_TRIANGLE_OVERLAP_PX,
	rasterFilter,
	tileOverlap,
	type Triangle,
} from '../raster.js';
import { fontFamily } from '../text.js';

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

	readonly #loadImage: ((source: string) => Promise<Image>) | undefined;

	/** Whether the context was saved for the clip circle, to be restored by `finish`. */
	#clipped = false;

	/** Decoded tile and sprite images, keyed by data URI: a tile may repeat within a layer. */
	readonly #images: ImageCache;

	readonly #patterns: CanvasPatterns;

	readonly #offscreen: Offscreen;

	public constructor(opt: CanvasRendererOptions) {
		this.width = opt.width;
		this.height = opt.height;
		this.scale = opt.scale ?? 1;
		this.canvas = opt.createCanvas(
			Math.round(this.width * this.scale),
			Math.round(this.height * this.scale),
		);
		this.#loadImage = opt.loadImage;
		this.#images = opt.images ?? new LRUCache<Image>(Infinity, () => 0);
		this.ctx = this.canvas.getContext('2d');
		// Draw in user units; the scale factor only changes how many device pixels each
		// unit covers.
		this.ctx.scale(this.scale, this.scale);
		this.#patterns = new CanvasPatterns(this.ctx, opt.createCanvas, this.scale, (dataUri) =>
			this.#decode(dataUri),
		);
		this.#offscreen = new Offscreen(this.canvas, this.ctx, opt.createCanvas, this.scale);
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

	public async drawBackgroundFill(style: BackgroundStyle): Promise<void> {
		// Every background layer paints over what is below it, like any other layer. (A
		// transparent one, e.g. an empty "slot" layer, must not erase an earlier background.)
		if (style.pattern) {
			if (style.opacity <= 0) return;
			const { pattern } = style;
			const sheet = await this.#decode(pattern.sprite.sheetDataUri);
			if (pattern.angle) await this.#patterns.fill(pattern);
			this.#paint(this.ctx, [0, 0], style.opacity, (ctx) => {
				this.#patterns.tile(ctx, pattern, sheet, [0, 0, this.width, this.height]);
			});
			return;
		}
		const color = new Color(style.color);
		color.alpha *= style.opacity;
		if (color.alpha <= 0) return;
		this.ctx.save();
		this.ctx.fillStyle = color.hex;
		this.ctx.fillRect(-1, -1, this.width + 2, this.height + 2);
		this.ctx.restore();
	}

	public async drawPolygons(_id: string, features: [Feature, FillStyle][]): Promise<void> {
		if (features.length === 0) return;

		// Decode the patterns' sprite sheets up front, so the drawing itself keeps the
		// features in order.
		const sheets = new Map<string, Image>();
		const outlineFills = new Map<FillPattern, CanvasPattern>();
		for (const [, style] of features) {
			const { pattern } = style;
			if (!pattern) continue;
			const uri = pattern.sprite.sheetDataUri;
			if (!sheets.has(uri)) sheets.set(uri, await this.#decode(uri));
			// A turned pattern is drawn as a canvas pattern (see CanvasPatterns.tile).
			if (pattern.angle) await this.#patterns.fill(pattern);
			if (style.antialias && style.outlineColor === undefined && !outlineFills.has(pattern)) {
				outlineFills.set(pattern, await this.#patterns.fill(pattern));
			}
		}

		// Unlike the SVG backend there is nothing to merge: canvas blends every draw call
		// separately, which is exactly what MapLibre does per feature. Fills and antialias
		// outlines are still collected in one pass and drawn in two, because MapLibre draws
		// every fill first and every outline after, so a lower feature's border composites
		// on top of a later overlapping fill.
		const outlines: { feature: Feature; style: FillStyle; paint: string | CanvasPattern }[] = [];

		for (const [feature, style] of features) {
			if (style.opacity <= 0) continue;

			const color = new Color(style.color);
			// A pattern is drawn instead of the color.
			const { pattern } = style;
			const translucent = style.opacity < 1 || (!pattern && color.alpha < 255);

			if (pattern) {
				const sheet = sheets.get(pattern.sprite.sheetDataUri)!;
				this.#paint(this.ctx, style.translate, style.opacity, (ctx) => {
					this.#trace(ctx, toSegments(feature.geometry), true);
					ctx.clip();
					this.#patterns.tile(ctx, pattern, sheet, feature.getBbox());
				});
			} else if (color.alpha > 0) {
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
			// Without a fill-outline-color, a pattern's outline is drawn with the pattern too,
			// as in MapLibre.
			if (style.antialias && (style.outlineColor !== undefined || translucent)) {
				const outlinePattern = pattern && outlineFills.get(pattern);
				if (style.outlineColor === undefined && outlinePattern) {
					outlines.push({ feature, style, paint: outlinePattern });
				} else {
					const outlineColor =
						style.outlineColor !== undefined ? new Color(style.outlineColor) : color;
					if (outlineColor.alpha > 0) outlines.push({ feature, style, paint: outlineColor.hex });
				}
			}
		}

		for (const { feature, style, paint } of outlines) {
			this.#paint(this.ctx, style.translate, style.opacity, (ctx) => {
				ctx.strokeStyle = paint;
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

	public async drawLineStrings(_id: string, features: [Feature, LineStyle][]): Promise<void> {
		if (features.length === 0) return;

		for (const [feature, style] of features) {
			if (style.opacity <= 0) continue;
			if (style.pattern) {
				if (style.width > 0) await this.#patternedLine(feature, style, style.pattern);
				continue;
			}
			const color = new Color(style.color);
			if (style.width <= 0 || color.alpha <= 0) continue;

			// MapLibre's line-blur fades the line as the blur approaches its width (the
			// feather eats into the opaque core); a Gaussian conserves total ink, so the fade
			// is approximated with an extra opacity factor.
			const blurOpacity =
				style.blur > 0 ? style.width / (style.width + BLUR_OPACITY_K * style.blur) : 1;
			const opacity = style.opacity * blurOpacity;

			const lines = strokeLines(feature.geometry, feature.type === 'Polygon', style.offset);
			const segments = lines.open.map(toSegment);
			const rings = lines.closed.map(toSegment);
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
				} else if (segments.length > 0) {
					this.#trace(ctx, chainSegments(segments), false);
					ctx.stroke();
				}
				// A polygon's rings are closed, so their start is joined too.
				for (const ring of rings) {
					this.#trace(ctx, [ring], true);
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
			this.#offscreen.isolate(
				regionOf([...segments, ...rings], style.translate, margin),
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

	/**
	 * A line drawn with `line-pattern`, as the SVG backend draws it: every segment covered
	 * with copies of the image along it (see `linePatternStrips`), in an offscreen layer that
	 * is then cut to the line as it is stroked, with its joins and caps.
	 */
	async #patternedLine(feature: Feature, style: LineStyle, pattern: LinePattern): Promise<void> {
		const lines = strokeLines(feature.geometry, feature.type === 'Polygon', style.offset);
		const strips = [
			...lines.open.flatMap((line) => linePatternStrips(line, false, style.width)),
			...lines.closed.flatMap((ring) => linePatternStrips(ring, true, style.width)),
		];
		if (strips.length === 0) return;
		const sheet = await this.#decode(pattern.sprite.sheetDataUri);
		const { sprite, period } = pattern;
		const width = style.width;
		const segments = lines.open.map(toSegment);
		const rings = lines.closed.map(toSegment);
		const margin = (width / 2) * Math.max(style.miterLimit, 1) + 2;

		this.#offscreen.isolate(
			regionOf([...segments, ...rings], style.translate, margin),
			style.opacity,
			undefined,
			(ctx) => {
				applyTranslate(ctx, style.translate);
				for (const { matrix, polygon } of strips) {
					ctx.save();
					ctx.transform(...matrix);
					ctx.beginPath();
					for (const [s, t] of polygon) ctx.lineTo(s, t);
					ctx.closePath();
					ctx.clip();
					const along = polygon.map(([s]) => s);
					const first = Math.floor(Math.min(...along) / period);
					const last = Math.ceil(Math.max(...along) / period);
					// A row of copies on each side too, for the line's smoothed edges.
					for (let k = first; k < last; k++) {
						for (let row = -1; row <= 1; row++) {
							ctx.drawImage(
								sheet,
								sprite.x,
								sprite.y,
								sprite.width,
								sprite.height,
								k * period,
								row * width,
								period,
								width,
							);
						}
					}
					ctx.restore();
				}
				// Keep only what the stroked line covers.
				ctx.globalCompositeOperation = 'destination-in';
				ctx.strokeStyle = '#000000';
				ctx.lineWidth = width;
				ctx.lineCap = style.cap;
				ctx.lineJoin = style.join;
				ctx.miterLimit = style.miterLimit;
				if (segments.length > 0) {
					this.#trace(ctx, chainSegments(segments), false);
					ctx.stroke();
				}
				for (const ring of rings) {
					this.#trace(ctx, [ring], true);
					ctx.stroke();
				}
			},
		);
	}

	public drawCircles(_id: string, features: [Feature, CircleStyle][]): void {
		if (features.length === 0) return;

		for (const [feature, style] of features) {
			const color = new Color(style.color);
			const strokeColor = new Color(style.strokeColor);

			if ((style.blur ?? 0) > 0) {
				// Blurred: one circle, fill and stroke in a radial gradient that fades out.
				const { radius, stops } = circleGradient(
					style,
					{ rgb: color.rgbBytes, alpha: color.opacity },
					{ rgb: strokeColor.rgbBytes, alpha: strokeColor.opacity },
				);
				if (radius <= 0) continue;
				this.#paint(this.ctx, style.translate, 1, (ctx) => {
					for (const ring of feature.geometry) {
						const point = ring[0];
						if (!point) continue;
						const [ux, uy] = roundPoint(point.x, point.y);
						const x = ux / UNITS_PER_PX;
						const y = uy / UNITS_PER_PX;
						const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
						for (const stop of stops) {
							const [r, g, b] = stop.rgb.map((c) => Math.round(c));
							gradient.addColorStop(
								stop.offset,
								`rgba(${String(r)},${String(g)},${String(b)},${String(stop.opacity)})`,
							);
						}
						ctx.fillStyle = gradient;
						ctx.beginPath();
						ctx.arc(x, y, radius, 0, 2 * Math.PI);
						ctx.fill();
					}
				});
				continue;
			}

			const { fill, stroke } = circleShape(style, color.opacity, strokeColor.opacity);
			if (!fill && !stroke) continue;

			this.#paint(this.ctx, style.translate, 1, (ctx) => {
				ctx.fillStyle = color.rgb;
				ctx.strokeStyle = strokeColor.rgb;
				for (const ring of feature.geometry) {
					const point = ring[0];
					if (!point) continue;
					const [ux, uy] = roundPoint(point.x, point.y);
					const x = ux / UNITS_PER_PX;
					const y = uy / UNITS_PER_PX;
					if (fill) {
						ctx.globalAlpha = fill.opacity;
						ctx.beginPath();
						ctx.arc(x, y, fill.radius, 0, 2 * Math.PI);
						ctx.fill();
					}
					if (stroke) {
						ctx.globalAlpha = stroke.opacity;
						ctx.lineWidth = stroke.width;
						ctx.beginPath();
						ctx.arc(x, y, stroke.radius, 0, 2 * Math.PI);
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
			this.#offscreen.isolate(
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
		const filter = rasterFilter(style);
		if (filter) ctx.filter = filter;
		if (style.resampling === 'nearest') ctx.imageSmoothingEnabled = false;

		this.#drawRasterMeshes(ctx, tiles, images);

		for (const tile of tiles) {
			if (tile.triangles) continue;
			const image = images.get(tile.dataUri);
			if (!image) continue;
			const overlap = tileOverlap(tile);
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

	/** Draws the tiles given as meshes of triangles (see {@link meshTriangles}). */
	#drawRasterMeshes(ctx: SKRSContext2D, tiles: RasterTile[], images: Map<string, Image>): void {
		const meshes = tiles.flatMap((tile) => {
			const image = tile.triangles ? images.get(tile.dataUri) : undefined;
			return image && tile.triangles
				? [{ image, triangles: tile.triangles, standalone: tile.standalone === true }]
				: [];
		});
		for (const { image, source, target } of meshTriangles(meshes)) {
			this.#drawRasterTriangle(ctx, image, source, target);
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

			// Each piece of the sprite image (see `iconQuads`), at its place from the point.
			const pieces = iconQuads(style, sprite);
			const quads = pieces.map((quad) => {
				const [left, top] = roundPoint(point.x + quad.left, point.y + quad.top);
				return {
					source: quad.source,
					x: left / UNITS_PER_PX,
					y: top / UNITS_PER_PX,
					width: quad.right - quad.left,
					height: quad.bottom - quad.top,
				};
			});
			const [left, top, right, bottom] = quadsBox(pieces);
			const box = {
				x: Math.min(...quads.map((quad) => quad.x)),
				y: Math.min(...quads.map((quad) => quad.y)),
				width: right - left,
				height: bottom - top,
			};
			// As in MapLibre, `icon-rotate` turns the icon, offset included, around its point.
			const [pivotX, pivotY] = roundPoint(point.x, point.y);
			const pivot: [number, number] = [pivotX / UNITS_PER_PX, pivotY / UNITS_PER_PX];

			const blit = (ctx: SKRSContext2D): void => {
				ctx.save();
				if (style.rotate !== 0) {
					ctx.translate(pivot[0], pivot[1]);
					ctx.rotate((style.rotate * Math.PI) / 180);
					ctx.translate(-pivot[0], -pivot[1]);
				}
				for (const quad of quads) {
					ctx.drawImage(
						sheet,
						quad.source.x,
						quad.source.y,
						quad.source.width,
						quad.source.height,
						quad.x,
						quad.y,
						quad.width,
						quad.height,
					);
				}
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
		this.#offscreen.isolateRaw(region, style.opacity, blit, (data, width, height) => {
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

	/**
	 * A label along a line: each glyph centered on its place and turned with the line. All
	 * halos come first, then all glyphs, as MapLibre draws them.
	 */
	#labelAlongLine(style: SymbolStyle, path: GlyphPlacement[], color: Color): void {
		const haloColor = new Color(style.haloColor);
		const hasHalo = style.haloWidth > 0 && haloColor.alpha > 0;
		this.#paint(this.ctx, [0, 0], style.opacity, (ctx) => {
			ctx.font = `${String(roundToTenths(style.size))}px ${fontFamily(style.font)}`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.strokeStyle = haloColor.hex;
			ctx.lineWidth = roundToTenths(style.haloWidth);
			ctx.lineJoin = 'round';
			ctx.fillStyle = color.hex;
			for (const pass of hasHalo ? ['halo', 'fill'] : ['fill']) {
				for (const glyph of path) {
					ctx.save();
					ctx.translate(glyph.x, glyph.y);
					ctx.rotate((glyph.angle * Math.PI) / 180);
					if (pass === 'halo') ctx.strokeText(glyph.text, 0, 0);
					else ctx.fillText(glyph.text, 0, 0);
					ctx.restore();
				}
			}
		});
	}

	/**
	 * A label drawn as its glyphs' outlines, each moved, turned and scaled into place. All
	 * halos come first, then all glyphs, as MapLibre draws them.
	 */
	#glyphLabel(style: SymbolStyle, glyphs: PlacedGlyph[], color: Color): void {
		const haloColor = new Color(style.haloColor);
		const hasHalo = style.haloWidth > 0 && haloColor.alpha > 0;
		this.#paint(this.ctx, [0, 0], style.opacity, (ctx) => {
			ctx.fillStyle = color.hex;
			ctx.strokeStyle = haloColor.hex;
			ctx.lineJoin = 'round';
			for (const pass of hasHalo ? ['halo', 'fill'] : ['fill']) {
				for (const glyph of glyphs) {
					if (glyph.outline.rings.length === 0) continue;
					ctx.save();
					ctx.translate(glyph.x, glyph.y);
					ctx.rotate((glyph.angle * Math.PI) / 180);
					ctx.scale(glyph.scale, glyph.scale);
					ctx.beginPath();
					for (const ring of glyph.outline.rings) {
						ring.forEach(([x, y], i) => {
							if (i === 0) ctx.moveTo(x, y);
							else ctx.lineTo(x, y);
						});
						ctx.closePath();
					}
					if (pass === 'halo') {
						// The outlines are scaled; the halo's width is on screen.
						ctx.lineWidth = style.haloWidth / glyph.scale;
						ctx.stroke();
					} else {
						ctx.fill('evenodd');
					}
					ctx.restore();
				}
			}
		});
	}

	public drawLabels(_id: string, features: [Feature, SymbolStyle][]): void {
		if (features.length === 0) return;

		for (const [feature, style] of features) {
			if (style.opacity <= 0 || !style.text) continue;
			const color = new Color(style.color);
			if (color.alpha <= 0) continue;

			// Drawn as glyphs: their outlines. (Text over them, invisible, only matters in SVG.)
			if (style.glyphs) {
				this.#glyphLabel(style, style.glyphs, color);
				continue;
			}

			if (style.path) {
				this.#labelAlongLine(style, style.path, color);
				continue;
			}

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
				ctx.font = `${String(roundToTenths(style.size))}px ${fontFamily(style.font)}`;
				const spacing = (style.letterSpacing ?? 0) * style.size;
				if (spacing !== 0) ctx.letterSpacing = `${String(spacing)}px`;

				// One line at the point, or several, each at its own point (see SymbolStyle.lines).
				let lines: { text: string; x: number; y: number }[];
				if (style.lines) {
					const anchor = JUSTIFY_ANCHOR[style.justify ?? 'center'];
					const shift = letterSpacingShift(spacing, anchor);
					ctx.textAlign = CANVAS_TEXT_ALIGN[anchor];
					ctx.textBaseline = 'middle';
					lines = style.lines.map((line) => ({ ...line, x: line.x + shift }));
				} else {
					ctx.textAlign = CANVAS_TEXT_ALIGN[align];
					ctx.textBaseline = CANVAS_TEXT_BASELINE[baseline];
					const shift = letterSpacingShift(spacing, align);
					lines = [
						{ text: style.text, x: x + dx / UNITS_PER_PX + shift, y: y + dy / UNITS_PER_PX },
					];
				}

				const haloColor = new Color(style.haloColor);
				// Stroke first, then fill: the same order `paint-order="stroke fill"` gives the
				// SVG backend, so the halo stays behind the glyph.
				if (style.haloWidth > 0 && haloColor.alpha > 0) {
					ctx.strokeStyle = haloColor.hex;
					ctx.lineWidth = roundToTenths(style.haloWidth);
					ctx.lineJoin = 'round';
					for (const line of lines) ctx.strokeText(line.text, line.x, line.y);
				}
				ctx.fillStyle = color.hex;
				for (const line of lines) ctx.fillText(line.text, line.x, line.y);
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

function roundToTenths(v: number): number {
	return Math.round(v * UNITS_PER_PX) / UNITS_PER_PX;
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
