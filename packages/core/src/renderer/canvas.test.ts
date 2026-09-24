import { describe, expect, test, vi } from 'vitest';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { LRUCache } from '../lru_cache.js';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { CanvasRenderer } from './canvas.js';
import { Feature, Point2D } from '../geometry.js';
import type {
	CircleStyle,
	FillPattern,
	FillStyle,
	IconStyle,
	LineStyle,
	RasterStyle,
	RasterTile,
	SymbolStyle,
} from './types.js';
import type { SpriteAtlas, SpriteEntry } from '../sources/sprite.js';

function mc(hex: string, alpha = 1): Color {
	const r = (parseInt(hex.slice(1, 3), 16) / 255) * alpha;
	const g = (parseInt(hex.slice(3, 5), 16) / 255) * alpha;
	const b = (parseInt(hex.slice(5, 7), 16) / 255) * alpha;
	return new Color(r, g, b, alpha);
}

function makeRenderer(overrides: { width?: number; height?: number; scale?: number } = {}) {
	return new CanvasRenderer({ width: 256, height: 256, createCanvas, ...overrides });
}

function makePolygonFeature(points: [number, number][][]): Feature {
	return new Feature({
		type: 'Polygon',
		properties: {},
		geometry: points.map((ring) => ring.map(([x, y]) => new Point2D(x, y))),
	});
}

function makeLineFeature(points: [number, number][][]): Feature {
	return new Feature({
		type: 'LineString',
		properties: {},
		geometry: points.map((line) => line.map(([x, y]) => new Point2D(x, y))),
	});
}

function makePointFeature(points: [number, number][]): Feature {
	return new Feature({
		type: 'Point',
		properties: {},
		geometry: points.map(([x, y]) => [new Point2D(x, y)]),
	});
}

function fillStyle(overrides: Partial<FillStyle> = {}): FillStyle {
	return { color: mc('#FF0000'), opacity: 1, translate: [0, 0], ...overrides };
}

function lineStyle(overrides: Partial<LineStyle> = {}): LineStyle {
	return {
		blur: 0,
		cap: 'butt',
		color: mc('#FF0000'),
		join: 'miter',
		miterLimit: 2,
		offset: 0,
		opacity: 1,
		translate: [0, 0],
		width: 2,
		...overrides,
	};
}

function circleStyle(overrides: Partial<CircleStyle> = {}): CircleStyle {
	return {
		color: mc('#FF0000'),
		opacity: 1,
		radius: 10,
		translate: [0, 0],
		strokeWidth: 0,
		strokeColor: mc('#00FF00'),
		strokeOpacity: 1,
		...overrides,
	};
}

/** Device-pixel colour at (x, y) as [r, g, b, a]. */
function at(r: CanvasRenderer, x: number, y: number): number[] {
	return [...r.ctx.getImageData(x, y, 1, 1).data];
}

/** How many separate runs of opaque pixels lie along a horizontal scanline. */
function runsAlongRow(r: CanvasRenderer, y: number, width: number): number {
	let runs = 0;
	let previous = false;
	for (let x = 0; x < width; x++) {
		const on = at(r, x, y)[3]! > 128;
		if (on && !previous) runs++;
		previous = on;
	}
	return runs;
}

describe('CanvasRenderer', () => {
	describe('construction', () => {
		test('bitmap is the map size at scale 1', () => {
			const r = makeRenderer();
			expect([r.canvas.width, r.canvas.height]).toEqual([256, 256]);
		});

		test('scale multiplies the bitmap but not the map units', async () => {
			const r = makeRenderer({ width: 100, height: 50, scale: 2 });
			expect([r.canvas.width, r.canvas.height]).toEqual([200, 100]);
			expect([r.width, r.height]).toEqual([100, 50]);
			// A 10-unit square drawn at the origin covers 20 device pixels.
			await r.drawPolygons('p', [
				[
					makePolygonFeature([
						[
							[0, 0],
							[10, 0],
							[10, 10],
							[0, 10],
						],
					]),
					fillStyle(),
				],
			]);
			expect(at(r, 18, 18)[0]).toBeGreaterThan(200);
			expect(at(r, 22, 22)[3]).toBe(0);
		});
	});

	describe('drawBackgroundFill', () => {
		test('covers the whole canvas', async () => {
			const r = makeRenderer();
			await r.drawBackgroundFill({ color: mc('#0000FF'), opacity: 1 });
			expect(at(r, 0, 0)).toEqual([0, 0, 255, 255]);
			expect(at(r, 255, 255)).toEqual([0, 0, 255, 255]);
		});

		test('applies layer opacity', async () => {
			const r = makeRenderer();
			await r.drawBackgroundFill({ color: mc('#0000FF'), opacity: 0.5 });
			expect(at(r, 128, 128)[3]).toBeCloseTo(128, -1);
		});

		test('a fully transparent background does not erase what is below', async () => {
			const r = makeRenderer();
			await r.drawBackgroundFill({ color: mc('#0000FF'), opacity: 1 });
			await r.drawBackgroundFill({ color: mc('#FF0000'), opacity: 0 });
			expect(at(r, 128, 128)).toEqual([0, 0, 255, 255]);
		});
	});

	describe('drawPolygons', () => {
		const square = (): Feature =>
			makePolygonFeature([
				[
					[50, 50],
					[200, 50],
					[200, 200],
					[50, 200],
				],
			]);

		test('fills the polygon and nothing outside it', async () => {
			const r = makeRenderer();
			await r.drawPolygons('fill-test', [[square(), fillStyle()]]);
			expect(at(r, 128, 128)).toEqual([255, 0, 0, 255]);
			expect(at(r, 20, 20)[3]).toBe(0);
		});

		test('an inner ring is a hole (nonzero fill rule, as in SVG)', async () => {
			const r = makeRenderer();
			const donut = makePolygonFeature([
				[
					[50, 50],
					[200, 50],
					[200, 200],
					[50, 200],
				],
				[
					[100, 150],
					[150, 150],
					[150, 100],
					[100, 100],
				],
			]);
			await r.drawPolygons('fill-test', [[donut, fillStyle()]]);
			expect(at(r, 60, 128)[0]).toBeGreaterThan(200); // ring
			expect(at(r, 125, 125)[3]).toBe(0); // hole
		});

		test('applies fill-translate', async () => {
			const r = makeRenderer();
			await r.drawPolygons('fill-test', [[square(), fillStyle({ translate: [20, 0] })]]);
			expect(at(r, 55, 128)[3]).toBe(0); // vacated by the shift
			expect(at(r, 210, 128)[0]).toBeGreaterThan(200); // newly covered
		});

		test('skips zero opacity and fully transparent colours', async () => {
			const r = makeRenderer();
			await r.drawPolygons('fill-test', [[square(), fillStyle({ opacity: 0 })]]);
			await r.drawPolygons('fill-test', [[square(), fillStyle({ color: mc('#FF0000', 0) })]]);
			expect(at(r, 128, 128)[3]).toBe(0);
		});

		test('draws no antialias outline for an opaque fill without fill-outline-color', async () => {
			// The rasterizer already antialiases the fill edge, so redrawing it is redundant.
			const r = makeRenderer();
			await r.drawPolygons('fill-test', [[square(), fillStyle({ antialias: true })]]);
			// Just outside the edge stays empty — an outline would straddle it.
			expect(at(r, 50 - 1, 128)[3]).toBe(0);
		});

		test('draws the outline in fill-outline-color', async () => {
			// The outline is a hairline (half a pixel wide, centred on the edge), so it tints
			// the edge pixel rather than replacing it. Compare against the same fill without
			// an outline instead of guessing an absolute threshold.
			const plain = makeRenderer();
			await plain.drawPolygons('fill-test', [[square(), fillStyle()]]);
			const outlined = makeRenderer();
			await outlined.drawPolygons('fill-test', [
				[square(), fillStyle({ antialias: true, outlineColor: mc('#FFFFFF') })],
			]);
			expect(at(plain, 50, 128)[1]).toBe(0);
			expect(at(outlined, 50, 128)[1]).toBeGreaterThan(30);
		});

		test('a tile-clipped polygon is outlined along its outline, not its clipped edges', async () => {
			// `feature.outline` carries the boundary as open polylines, leaving out the edges
			// that only exist because the polygon was clipped to its tile.
			const clipped = new Feature({
				type: 'Polygon',
				properties: {},
				geometry: [
					[
						[50, 50],
						[200, 50],
						[200, 200],
						[50, 200],
					].map(([x, y]) => new Point2D(x!, y!)),
				],
				// Only the top edge is a real boundary; the rest follow the tile border.
				outline: [
					[
						[50, 50],
						[200, 50],
					].map(([x, y]) => new Point2D(x!, y!)),
				],
			});
			const r = makeRenderer();
			await r.drawPolygons('fill-test', [
				[clipped, fillStyle({ antialias: true, outlineColor: mc('#FFFFFF') })],
			]);
			expect(at(r, 128, 50)[1]).toBeGreaterThan(30); // outlined top edge
			expect(at(r, 128, 200)[1]).toBe(0); // clipped bottom edge, left bare
		});

		test('every fill is drawn before any outline', async () => {
			// MapLibre draws all fills, then all outlines, so a lower feature's border
			// composites on top of a later overlapping fill.
			const r = makeRenderer();
			const lower = makePolygonFeature([
				[
					[50, 50],
					[150, 50],
					[150, 150],
					[50, 150],
				],
			]);
			const upper = makePolygonFeature([
				[
					[100, 40],
					[220, 40],
					[220, 220],
					[100, 220],
				],
			]);
			await r.drawPolygons('fill-test', [
				[lower, fillStyle({ antialias: true, outlineColor: mc('#FFFFFF') })],
				[upper, fillStyle({ color: mc('#0000FF') })],
			]);
			// Without the outline the same pixel is pure upper-square blue...
			const control = makeRenderer();
			await control.drawPolygons('fill-test', [
				[lower, fillStyle()],
				[upper, fillStyle({ color: mc('#0000FF') })],
			]);
			expect(at(control, 150, 100)).toEqual([0, 0, 255, 255]);
			// ...so any white there is the lower square's border surviving on top.
			expect(at(r, 150, 100)[1]).toBeGreaterThan(20);
		});
	});

	describe('drawLineStrings', () => {
		const horizontal = (): Feature =>
			makeLineFeature([
				[
					[0, 128],
					[256, 128],
				],
			]);

		test('strokes in the line colour at the given width', async () => {
			const r = makeRenderer();
			await r.drawLineStrings('line-test', [[horizontal(), lineStyle({ width: 10 })]]);
			expect(at(r, 128, 128)).toEqual([255, 0, 0, 255]);
			expect(at(r, 128, 120)[3]).toBe(0);
			expect(at(r, 128, 126)[3]).toBeGreaterThan(200);
		});

		test('skips non-positive width and transparent colours', async () => {
			const r = makeRenderer();
			await r.drawLineStrings('line-test', [[horizontal(), lineStyle({ width: 0 })]]);
			await r.drawLineStrings('line-test', [
				[horizontal(), lineStyle({ color: mc('#FF0000', 0) })],
			]);
			expect(at(r, 128, 128)[3]).toBe(0);
		});

		test('applies stroke-dasharray', async () => {
			const r = makeRenderer();
			await r.drawLineStrings('line-test', [
				[horizontal(), lineStyle({ width: 4, dasharray: [4, 2] })],
			]);
			expect(runsAlongRow(r, 128, 256)).toBeGreaterThan(5);
		});

		test('line-cap square extends past the endpoint, butt does not', async () => {
			const segment = (): Feature =>
				makeLineFeature([
					[
						[100, 128],
						[150, 128],
					],
				]);
			const butt = makeRenderer();
			await butt.drawLineStrings('line-test', [[segment(), lineStyle({ width: 10, cap: 'butt' })]]);
			const square = makeRenderer();
			await square.drawLineStrings('line-test', [
				[segment(), lineStyle({ width: 10, cap: 'square' })],
			]);
			expect(at(butt, 97, 128)[3]).toBe(0);
			expect(at(square, 97, 128)[3]).toBeGreaterThan(200);
		});

		test('positive line-offset shifts an eastward line to the right (screen +y)', async () => {
			const r = makeRenderer();
			await r.drawLineStrings('line-test', [[horizontal(), lineStyle({ width: 4, offset: 10 })]]);
			expect(at(r, 128, 138)[3]).toBeGreaterThan(200);
			expect(at(r, 128, 128)[3]).toBe(0);
		});

		test('line-blur feathers the edge and fades the line', async () => {
			const sharp = makeRenderer();
			await sharp.drawLineStrings('line-test', [[horizontal(), lineStyle({ width: 10 })]]);
			const blurred = makeRenderer();
			await blurred.drawLineStrings('line-test', [
				[horizontal(), lineStyle({ width: 10, blur: 8 })],
			]);

			const feathered = (r: CanvasRenderer): number => {
				let count = 0;
				for (let y = 110; y < 146; y++) {
					const alpha = at(r, 128, y)[3]!;
					if (alpha > 5 && alpha < 250) count++;
				}
				return count;
			};
			expect(feathered(blurred)).toBeGreaterThan(feathered(sharp));
			// The fade keeps a blurred line from reading as bright as a sharp one.
			expect(at(blurred, 128, 128)[3]!).toBeLessThan(at(sharp, 128, 128)[3]!);
		});

		test('heavy blur fades a thin line out entirely, as MapLibre does', async () => {
			// The alpha curve clips the Gaussian's tails, so a blur far wider than the line
			// leaves nothing rather than a faint smear across the map.
			const r = makeRenderer();
			await r.drawLineStrings('line-test', [[horizontal(), lineStyle({ width: 2, blur: 40 })]]);
			for (let y = 100; y < 156; y++) expect(at(r, 128, y)[3]).toBe(0);
		});

		test('the blur alpha curve does not reach what was already drawn', async () => {
			// The curve rewrites alpha, so it has to run on an isolated layer. Sample a point
			// inside the blurred feature's region but far enough from the line that the line
			// itself contributes nothing: only already-drawn pixels live there.
			const r = makeRenderer();
			const backdrop = makePolygonFeature([
				[
					[0, 0],
					[256, 0],
					[256, 256],
					[0, 256],
				],
			]);
			await r.drawPolygons('bg', [[backdrop, fillStyle({ color: mc('#00FF00'), opacity: 0.5 })]]);
			const before = at(r, 10, 122);
			expect(before[3]).toBeCloseTo(128, -1); // the translucent backdrop

			await r.drawLineStrings('line-test', [[horizontal(), lineStyle({ width: 4, blur: 6 })]]);
			expect(at(r, 10, 122)).toEqual(before);
		});

		test('an axis-aligned blurred line is still drawn', async () => {
			// The SVG backend needs an explicit userSpaceOnUse filter region here, because a
			// horizontal path has a zero-area bounding box. Canvas has no such concept — this
			// pins that the case stays covered on both backends.
			const r = makeRenderer();
			await r.drawLineStrings('line-test', [[horizontal(), lineStyle({ width: 10, blur: 2 })]]);
			expect(at(r, 128, 128)[3]).toBeGreaterThan(20);
		});
	});

	describe('drawCircles', () => {
		test('fills a circle of the given radius', () => {
			const r = makeRenderer();
			r.drawCircles('circle-test', [[makePointFeature([[128, 128]]), circleStyle({ radius: 20 })]]);
			expect(at(r, 128, 128)).toEqual([255, 0, 0, 255]);
			expect(at(r, 128, 145)[3]).toBeGreaterThan(200);
			expect(at(r, 128, 155)[3]).toBe(0);
		});

		test('draws the stroke outside the radius, as MapLibre does', () => {
			const r = makeRenderer();
			r.drawCircles('circle-test', [
				[makePointFeature([[128, 128]]), circleStyle({ radius: 20, strokeWidth: 6 })],
			]);
			// Fill still reaches `radius`; the stroke sits on [radius, radius + strokeWidth].
			expect(at(r, 128, 128 + 18)[0]).toBeGreaterThan(200);
			expect(at(r, 128, 128 + 23)[1]).toBeGreaterThan(200);
			expect(at(r, 128, 128 + 30)[3]).toBe(0);
		});

		test('skips non-positive radius and zero opacity', () => {
			const r = makeRenderer();
			r.drawCircles('circle-test', [[makePointFeature([[128, 128]]), circleStyle({ radius: 0 })]]);
			r.drawCircles('circle-test', [[makePointFeature([[128, 128]]), circleStyle({ opacity: 0 })]]);
			expect(at(r, 128, 128)[3]).toBe(0);
		});
	});

	describe('setClipCircle', () => {
		test('restricts later drawing to the globe silhouette', async () => {
			const r = makeRenderer();
			r.setClipCircle({ x: 128, y: 128, radius: 50 });
			await r.drawBackgroundFill({ color: mc('#FF0000'), opacity: 1 });
			expect(at(r, 128, 128)[3]).toBe(255);
			expect(at(r, 5, 5)[3]).toBe(0);
		});
	});

	describe('drawRasterTiles', () => {
		// A 2x2 image: red, green / blue, white — big enough to tell orientation and
		// resampling apart, small enough to write inline.
		const tileUri = (() => {
			const canvas = createCanvas(2, 2);
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = '#FF0000';
			ctx.fillRect(0, 0, 1, 1);
			ctx.fillStyle = '#00FF00';
			ctx.fillRect(1, 0, 1, 1);
			ctx.fillStyle = '#0000FF';
			ctx.fillRect(0, 1, 1, 1);
			ctx.fillStyle = '#FFFFFF';
			ctx.fillRect(1, 1, 1, 1);
			return canvas.toDataURL('image/png');
		})();

		function rasterStyle(overrides: Partial<RasterStyle> = {}): RasterStyle {
			return {
				opacity: 1,
				hueRotate: 0,
				brightnessMin: 0,
				brightnessMax: 1,
				saturation: 0,
				contrast: 0,
				resampling: 'linear',
				...overrides,
			};
		}

		const makeRasterRenderer = () =>
			new CanvasRenderer({ width: 256, height: 256, createCanvas, loadImage });

		const tile = (overrides: Partial<RasterTile> = {}): RasterTile => ({
			x: 0,
			y: 0,
			width: 128,
			height: 128,
			dataUri: tileUri,
			...overrides,
		});

		test('draws a tile at its position and size', async () => {
			const r = makeRasterRenderer();
			await r.drawRasterTiles('raster', [tile()], rasterStyle());
			expect(at(r, 30, 30).slice(0, 3)).toEqual([255, 0, 0]); // top-left quadrant
			expect(at(r, 100, 30).slice(0, 3)).toEqual([0, 255, 0]); // top-right
			expect(at(r, 30, 100).slice(0, 3)).toEqual([0, 0, 255]); // bottom-left
			expect(at(r, 200, 200)[3]).toBe(0); // beyond the tile
		});

		test('places each tile of a grid at its own offset', async () => {
			const r = makeRasterRenderer();
			await r.drawRasterTiles(
				'raster',
				[tile(), tile({ x: 128 }), tile({ y: 128 }), tile({ x: 128, y: 128 })],
				rasterStyle(),
			);
			for (const [x, y] of [
				[30, 30],
				[158, 30],
				[30, 158],
				[158, 158],
			]) {
				expect(at(r, x!, y!).slice(0, 3)).toEqual([255, 0, 0]);
			}
		});

		test('skips drawing entirely at zero opacity', async () => {
			const r = makeRasterRenderer();
			await r.drawRasterTiles('raster', [tile()], rasterStyle({ opacity: 0 }));
			expect(at(r, 30, 30)[3]).toBe(0);
		});

		test('applies raster-opacity', async () => {
			const r = makeRasterRenderer();
			await r.drawRasterTiles('raster', [tile()], rasterStyle({ opacity: 0.5 }));
			expect(at(r, 30, 30)[3]).toBeCloseTo(128, -1);
		});

		test('applies the raster colour adjustments', async () => {
			const plain = makeRasterRenderer();
			await plain.drawRasterTiles('raster', [tile()], rasterStyle());
			const dimmed = makeRasterRenderer();
			await dimmed.drawRasterTiles(
				'raster',
				[tile()],
				rasterStyle({ brightnessMin: 0, brightnessMax: 0.5 }),
			);
			expect(at(dimmed, 30, 30)[0]!).toBeLessThan(at(plain, 30, 30)[0]!);
		});

		test('nearest resampling keeps hard pixel edges', async () => {
			const linear = makeRasterRenderer();
			await linear.drawRasterTiles('raster', [tile()], rasterStyle({ resampling: 'linear' }));
			const nearest = makeRasterRenderer();
			await nearest.drawRasterTiles('raster', [tile()], rasterStyle({ resampling: 'nearest' }));
			// Right at the quadrant boundary, linear blends the two colours; nearest does not.
			expect(at(nearest, 64, 30).slice(0, 3)).toEqual([0, 255, 0]);
			expect(at(linear, 64, 30)[0]!).toBeGreaterThan(0);
		});

		test('draws a globe tile as a mesh of clipped triangles', async () => {
			const r = makeRasterRenderer();
			// Two triangles covering the square (0,0)-(200,200) on screen.
			await r.drawRasterTiles(
				'raster',
				[
					tile({
						width: 1,
						height: 1,
						triangles: [
							{
								source: [
									[0, 0],
									[1, 0],
									[0, 1],
								],
								target: [
									[0, 0],
									[200, 0],
									[0, 200],
								],
							},
							{
								source: [
									[1, 0],
									[1, 1],
									[0, 1],
								],
								target: [
									[200, 0],
									[200, 200],
									[0, 200],
								],
							},
						],
					}),
				],
				rasterStyle(),
			);
			// The image is mapped across both triangles, so its quadrants land in order...
			expect(at(r, 40, 40).slice(0, 3)).toEqual([255, 0, 0]);
			expect(at(r, 160, 40).slice(0, 3)).toEqual([0, 255, 0]);
			expect(at(r, 40, 160).slice(0, 3)).toEqual([0, 0, 255]);
			// ...and nothing is painted outside the mesh.
			expect(at(r, 240, 240)[3]).toBe(0);
		});

		test('a translucent raster layer is flattened before its opacity is applied', async () => {
			// Tiles overlap on purpose to hide the seams between them, so per-tile opacity
			// would make every seam darker than the rest of the layer.
			const r = makeRasterRenderer();
			await r.drawRasterTiles(
				'raster',
				[tile({ x: 0, width: 100 }), tile({ x: 50, width: 100 })],
				rasterStyle({ opacity: 0.5 }),
			);
			const single = at(r, 20, 30)[3];
			const overlap = at(r, 70, 30)[3];
			expect(single).toBeCloseTo(128, -1);
			expect(overlap).toBe(single);
		});

		test('renderers sharing an image cache decode a tile once', async () => {
			const images = new LRUCache<Image>(Infinity, () => 0);
			const load = vi.fn(loadImage);
			for (let i = 0; i < 2; i++) {
				const r = new CanvasRenderer({
					width: 256,
					height: 256,
					createCanvas,
					loadImage: load,
					images,
				});
				await r.drawRasterTiles('r', [tile()], rasterStyle());
			}
			expect(load).toHaveBeenCalledTimes(1);
		});

		test('without a shared image cache, each renderer decodes its own tiles', async () => {
			const load = vi.fn(loadImage);
			for (let i = 0; i < 2; i++) {
				const r = new CanvasRenderer({ width: 256, height: 256, createCanvas, loadImage: load });
				await r.drawRasterTiles('r', [tile(), tile({ x: 128 })], rasterStyle());
			}
			expect(load).toHaveBeenCalledTimes(2);
		});

		test('needs a loadImage to draw tiles at all', async () => {
			const r = makeRenderer(); // constructed without `loadImage`
			await expect(r.drawRasterTiles('raster', [tile()], rasterStyle())).rejects.toThrow(
				/loadImage/,
			);
		});
	});

	describe('patterns', () => {
		// An 8x8 image at pixel ratio 2: 4 px on screen, the left half red, the right blue.
		const sheet = (() => {
			const canvas = createCanvas(8, 8);
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = '#FF0000';
			ctx.fillRect(0, 0, 4, 8);
			ctx.fillStyle = '#0000FF';
			ctx.fillRect(4, 0, 4, 8);
			return canvas.toDataURL('image/png');
		})();
		const pattern = (origin: [number, number]): FillPattern => ({
			name: 'stripes',
			origin,
			sprite: {
				width: 8,
				height: 8,
				x: 0,
				y: 0,
				pixelRatio: 2,
				sdf: false,
				sheetDataUri: sheet,
				sheetWidth: 8,
				sheetHeight: 8,
			},
		});
		const makePatternRenderer = () =>
			new CanvasRenderer({ width: 16, height: 4, createCanvas, loadImage });
		/** R or B per pixel along row 1. */
		const row = (r: CanvasRenderer): string =>
			[...Array(16).keys()]
				.map((x) => {
					const [red, , blue] = at(r, x, 1);
					return red! > 200 ? 'R' : blue! > 200 ? 'B' : '.';
				})
				.join('');

		test('repeats the image at its display size, from the origin', async () => {
			const r = makePatternRenderer();
			const square = makePolygonFeature([
				[
					[0, 0],
					[16, 0],
					[16, 4],
					[0, 4],
					[0, 0],
				],
			]);
			// The origin lies far away, as the world's origin does: only its phase counts.
			await r.drawPolygons('p', [[square, fillStyle({ pattern: pattern([-4003, 0]) })]]);
			expect(row(r)).toBe('BRRBBRRBBRRBBRRB');
		});

		test('fills the background with the pattern', async () => {
			const r = makePatternRenderer();
			await r.drawBackgroundFill({ color: mc('#00FF00'), opacity: 1, pattern: pattern([0, 0]) });
			expect(row(r)).toBe('RRBBRRBBRRBBRRBB');
		});

		test('scales the pattern with the map at a fractional zoom level', async () => {
			const r = makePatternRenderer();
			const scaled = { ...pattern([0, 0]), scale: 2 };
			await r.drawBackgroundFill({ color: mc('#00FF00'), opacity: 1, pattern: scaled });
			expect(row(r)).toBe('RRRRBBBBRRRRBBBB');
		});

		test('repeats a line pattern along the line, across its width only', async () => {
			const r = new CanvasRenderer({ width: 16, height: 8, createCanvas, loadImage });
			const line = makeLineFeature([
				[
					[0, 4],
					[16, 4],
				],
			]);
			const { sprite } = pattern([0, 0]);
			await r.drawLineStrings('l', [
				[line, lineStyle({ width: 4, pattern: { name: 'stripes', sprite, period: 4 } })],
			]);
			const along = (y: number): string =>
				[...Array(16).keys()]
					.map((x) => {
						const [red, , blue, alpha] = at(r, x, y);
						if (alpha! < 200) return '.';
						return red! > 200 ? 'R' : blue! > 200 ? 'B' : '?';
					})
					.join('');
			expect(along(4)).toBe('RRBBRRBBRRBBRRBB');
			expect(along(0)).toBe('................');
		});
	});

	describe('drawIcons', () => {
		// A sprite sheet with one opaque green 8x8 sprite at (8, 0), and one soft-edged
		// sprite at (0, 0) standing in for an SDF glyph (alpha ramps across it).
		const sheet = (() => {
			const canvas = createCanvas(16, 8);
			const ctx = canvas.getContext('2d');
			for (let x = 0; x < 8; x++) {
				// alpha 0 at the left edge, 1 at the right: the 0.75 threshold falls at x = 6.
				ctx.fillStyle = `rgba(0,0,0,${String(x / 7)})`;
				ctx.fillRect(x, 0, 1, 8);
			}
			ctx.fillStyle = '#00FF00';
			ctx.fillRect(8, 0, 8, 8);
			return canvas.toDataURL('image/png');
		})();

		function atlas(overrides: Partial<SpriteEntry> = {}): SpriteAtlas {
			return new Map([
				[
					'pin',
					{
						width: 8,
						height: 8,
						x: 8,
						y: 0,
						pixelRatio: 1,
						sdf: false,
						sheetDataUri: sheet,
						sheetWidth: 16,
						sheetHeight: 8,
						...overrides,
					},
				],
			]);
		}

		function iconStyle(overrides: Partial<IconStyle> = {}): IconStyle {
			return {
				image: 'pin',
				size: 1,
				anchor: 'center',
				offset: [0, 0],
				rotate: 0,
				opacity: 1,
				sdf: false,
				color: mc('#FF0000'),
				haloColor: mc('#0000FF'),
				haloWidth: 0,
				...overrides,
			};
		}

		const makeIconRenderer = () =>
			new CanvasRenderer({ width: 64, height: 64, createCanvas, loadImage });

		test('blits the sprite, centred on its point by default', async () => {
			const r = makeIconRenderer();
			await r.drawIcons('icons', [[makePointFeature([[32, 32]]), iconStyle()]], atlas());
			expect(at(r, 32, 32).slice(0, 3)).toEqual([0, 255, 0]);
			// 8x8 centred on (32,32) spans 28..36, so 26 is outside.
			expect(at(r, 26, 32)[3]).toBe(0);
		});

		test('honours icon-anchor', async () => {
			const r = makeIconRenderer();
			await r.drawIcons(
				'icons',
				[[makePointFeature([[32, 32]]), iconStyle({ anchor: 'top-left' })]],
				atlas(),
			);
			expect(at(r, 35, 35).slice(0, 3)).toEqual([0, 255, 0]); // down-right of the point
			expect(at(r, 29, 29)[3]).toBe(0);
		});

		test('draws a fitted icon in pieces: the stretch zones stretched, the rest kept', async () => {
			// The soft sprite: columns 0–1 and 6–7 keep their size, 2–5 stretch.
			const r = makeIconRenderer();
			await r.drawIcons(
				'icons',
				[[makePointFeature([[32, 32]]), iconStyle({ fit: [-20, -4, 20, 4] })]],
				atlas({ x: 0, stretchX: [[2, 6]] }),
			);
			// It spans 12..52; its last column is opaque, its first nearly transparent.
			expect(at(r, 51, 32)[3]).toBeGreaterThan(200);
			expect(at(r, 12, 32)[3]).toBeLessThan(20);
			// The middle is the stretched middle of the ramp.
			expect(at(r, 32, 32)[3]).toBeGreaterThan(80);
			expect(at(r, 32, 32)[3]).toBeLessThan(180);
			expect(at(r, 53, 32)[3]).toBe(0);
			expect(at(r, 10, 32)[3]).toBe(0);
		});

		test('skips an unknown sprite and zero opacity', async () => {
			const r = makeIconRenderer();
			await r.drawIcons(
				'icons',
				[[makePointFeature([[32, 32]]), iconStyle({ image: 'nope' })]],
				atlas(),
			);
			await r.drawIcons(
				'icons',
				[[makePointFeature([[32, 32]]), iconStyle({ opacity: 0 })]],
				atlas(),
			);
			expect(at(r, 32, 32)[3]).toBe(0);
		});

		test('an SDF icon is recoloured at the 0.75 alpha edge', async () => {
			const r = makeIconRenderer();
			await r.drawIcons(
				'icons',
				[
					[
						makePointFeature([[32, 32]]),
						iconStyle({ sdf: true, anchor: 'top-left', color: mc('#FF0000') }),
					],
				],
				// the soft-edged sprite: alpha ramps 0..1 across its 8 columns
				atlas({ x: 0, sdf: true }),
			);
			// Inside the glyph (alpha >= 0.75) the icon colour replaces the sprite's own.
			expect(at(r, 39, 34).slice(0, 3)).toEqual([255, 0, 0]);
			// Outside it, nothing is painted at all — the soft ramp is cut, not faded.
			expect(at(r, 33, 34)[3]).toBe(0);
		});

		test('an SDF halo surrounds the glyph in the halo colour', async () => {
			const r = makeIconRenderer();
			await r.drawIcons(
				'icons',
				[
					[
						makePointFeature([[32, 32]]),
						iconStyle({
							sdf: true,
							anchor: 'top-left',
							color: mc('#FF0000'),
							haloColor: mc('#0000FF'),
							haloWidth: 2,
						}),
					],
				],
				atlas({ x: 0, sdf: true }),
			);
			// The sprite's alpha only crosses 0.75 in its last two columns, so the glyph lands
			// at x = 38..39 and a halo of 2 dilates it out to x = 36.
			expect(at(r, 39, 34).slice(0, 3)).toEqual([255, 0, 0]); // glyph
			expect(at(r, 36, 34).slice(0, 3)).toEqual([0, 0, 255]); // dilated halo
			expect(at(r, 34, 34)[3]).toBe(0); // beyond the halo
		});

		test('icon-rotate turns the icon about its point', async () => {
			const r = makeIconRenderer();
			await r.drawIcons(
				'icons',
				[[makePointFeature([[32, 32]]), iconStyle({ anchor: 'top-left', rotate: 90 })]],
				atlas(),
			);
			// Unrotated the icon covers x 32..40; a quarter turn about (32,32) swings it to
			// x 24..32, keeping y 32..40.
			expect(at(r, 28, 36).slice(0, 3)).toEqual([0, 255, 0]);
			expect(at(r, 36, 36)[3]).toBe(0);
		});

		test('needs a loadImage to draw icons at all', async () => {
			const r = makeRenderer();
			await expect(
				r.drawIcons('icons', [[makePointFeature([[32, 32]]), iconStyle()]], atlas()),
			).rejects.toThrow(/loadImage/);
		});
	});

	describe('drawLabels', () => {
		function symbolStyle(overrides: Partial<SymbolStyle> = {}): SymbolStyle {
			return {
				text: 'Berlin',
				size: 32,
				font: ['Helvetica'],
				anchor: 'center',
				offset: [0, 0],
				rotate: 0,
				color: mc('#FF0000'),
				opacity: 1,
				haloColor: mc('#0000FF'),
				haloWidth: 0,
				...overrides,
			};
		}

		const paintedPixels = (r: CanvasRenderer, match: (px: number[]) => boolean): number => {
			const { data } = r.ctx.getImageData(0, 0, 256, 256);
			let count = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (match([data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!])) count++;
			}
			return count;
		};

		test('fills the outlines of a label drawn as glyphs', () => {
			const r = makeRenderer();
			const outline = {
				key: 'square',
				rings: [
					[
						[-12, -12],
						[12, -12],
						[12, 12],
						[-12, 12],
					] as [number, number][],
				],
				advance: 1,
			};
			// A 24-unit square at scale 0.5: 12 px around (100, 100).
			const glyphs = [{ outline, x: 100, y: 100, angle: 0, scale: 0.5 }];
			r.drawLabels('l', [[makePointFeature([[0, 0]]), symbolStyle({ glyphs, textOverlay: true })]]);
			expect(at(r, 100, 100).slice(0, 4)).toEqual([255, 0, 0, 255]);
			expect(at(r, 104, 104)[3]).toBe(255);
			expect(at(r, 110, 100)[3]).toBe(0);
		});

		test('draws a label of several lines, each at its point', () => {
			const r = makeRenderer();
			const lines = [
				{ text: 'HHH', x: 128, y: 60 },
				{ text: 'HHH', x: 128, y: 200 },
			];
			r.drawLabels('l', [[makePointFeature([[0, 0]]), symbolStyle({ text: 'HHH\nHHH', lines })]]);
			const redInRow = (y: number) =>
				[...Array(256).keys()].some((x) => {
					const px = at(r, x, y);
					return px[0]! > 200 && px[3]! > 200;
				});
			expect(redInRow(60)).toBe(true);
			expect(redInRow(200)).toBe(true);
			expect(redInRow(130)).toBe(false);
		});

		test('draws a label along a line glyph by glyph, where the path says', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[0, 0]]);
			// Two glyphs far apart in the lower right, the second turned by 90°.
			const path = [
				{ text: 'H', x: 150, y: 150, angle: 0 },
				{ text: 'H', x: 220, y: 220, angle: 90 },
			];
			r.drawLabels('l', [[feature, symbolStyle({ text: 'HH', path })]]);
			const red = (px: number[]) => px[0]! > 200 && px[1]! < 80 && px[3]! > 200;
			expect(paintedPixels(r, red)).toBeGreaterThan(50);
			// Nothing at the feature's own point.
			expect(at(r, 2, 2)[3]).toBe(0);
			// The glyphs are around their positions.
			const nearFirst = [...Array(20).keys()].some((d) => red(at(r, 140 + d, 150)));
			const nearSecond = [...Array(20).keys()].some((d) => red(at(r, 220, 210 + d)));
			expect(nearFirst && nearSecond).toBe(true);
		});

		test('draws the label text', () => {
			const r = makeRenderer();
			r.drawLabels('labels', [[makePointFeature([[128, 128]]), symbolStyle()]]);
			expect(paintedPixels(r, (p) => p[3]! > 128)).toBeGreaterThan(50);
		});

		test('skips empty text, zero opacity and transparent colours', () => {
			const r = makeRenderer();
			r.drawLabels('labels', [[makePointFeature([[128, 128]]), symbolStyle({ text: '' })]]);
			r.drawLabels('labels', [[makePointFeature([[128, 128]]), symbolStyle({ opacity: 0 })]]);
			r.drawLabels('labels', [
				[makePointFeature([[128, 128]]), symbolStyle({ color: mc('#FF0000', 0) })],
			]);
			expect(paintedPixels(r, (p) => p[3]! > 0)).toBe(0);
		});

		test('text-anchor moves the label relative to its point', () => {
			const leftOf = (anchor: string): number => {
				const r = makeRenderer();
				r.drawLabels('labels', [[makePointFeature([[128, 128]]), symbolStyle({ anchor })]]);
				const { data } = r.ctx.getImageData(0, 0, 256, 256);
				for (let x = 0; x < 256; x++) {
					for (let y = 0; y < 256; y++) if (data[(y * 256 + x) * 4 + 3]! > 128) return x;
				}
				return -1;
			};
			// 'left' anchors the text's start at the point; 'right' ends it there.
			expect(leftOf('left')).toBeGreaterThan(leftOf('right'));
		});

		test('text-rotate turns the label about its point', () => {
			const boundsOf = (rotate: number): { width: number; height: number } => {
				const r = makeRenderer();
				r.drawLabels('labels', [[makePointFeature([[128, 128]]), symbolStyle({ rotate })]]);
				const { data } = r.ctx.getImageData(0, 0, 256, 256);
				let minX = 256,
					maxX = -1,
					minY = 256,
					maxY = -1;
				for (let y = 0; y < 256; y++) {
					for (let x = 0; x < 256; x++) {
						if (data[(y * 256 + x) * 4 + 3]! > 128) {
							if (x < minX) minX = x;
							if (x > maxX) maxX = x;
							if (y < minY) minY = y;
							if (y > maxY) maxY = y;
						}
					}
				}
				return { width: maxX - minX, height: maxY - minY };
			};
			const flat = boundsOf(0);
			const turned = boundsOf(90);
			expect(flat.width).toBeGreaterThan(flat.height); // a wide line of text
			expect(turned.height).toBeGreaterThan(turned.width); // stood on end
		});

		test('the halo is drawn behind the glyph, not over it', () => {
			const r = makeRenderer();
			r.drawLabels('labels', [[makePointFeature([[128, 128]]), symbolStyle({ haloWidth: 4 })]]);
			const glyph = paintedPixels(r, (p) => p[0]! > 200 && p[2]! < 60);
			const halo = paintedPixels(r, (p) => p[2]! > 200 && p[0]! < 60);
			expect(glyph).toBeGreaterThan(50);
			expect(halo).toBeGreaterThan(50);
		});
	});

	describe('toBuffer', () => {
		test('encodes a PNG', async () => {
			const r = makeRenderer({ width: 10, height: 10 });
			await r.drawBackgroundFill({ color: mc('#FF0000'), opacity: 1 });
			const buffer = r.toBuffer();
			expect([...buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		});
	});
});
