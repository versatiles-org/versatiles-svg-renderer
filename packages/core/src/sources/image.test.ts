import { describe, expect, test, vi } from 'vitest';
import { getImageSourceTiles, imageWarp } from './image.js';
import { getRasterTiles } from './raster.js';
import { Projection } from '../projection.js';
import { Point2D } from '../geometry.js';
import type { Renderer, RenderJob } from '../types.js';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

const RECTANGLE = [
	[-10, 10],
	[10, 10],
	[10, -10],
	[-10, -10],
];

function makeJob(coordinates: unknown, projection?: Projection): RenderJob {
	return {
		renderer: { width: 512, height: 512 } as Renderer,
		view: { zoom: 2, center: [0, 0] },
		style: {
			sources: { img: { type: 'image', url: 'https://a/image.png', coordinates } },
			version: 8,
			layers: [],
		} as unknown as StyleSpecification,
		projection,
	};
}

const loadImage = vi.fn(() =>
	Promise.resolve({ buffer: new ArrayBuffer(1), contentType: 'image/png' }),
);

function mercator(lng: number, lat: number): [number, number] {
	const point = new Point2D(lng, lat).getProject2Pixel();
	return [point.x, point.y];
}

describe('getImageSourceTiles', () => {
	test('loads the image from its URL, like a tile without placeholders', async () => {
		const loadTile = vi.fn(loadImage);
		await getImageSourceTiles(makeJob(RECTANGLE), 'img', loadTile);
		expect(loadTile).toHaveBeenCalledWith('https://a/image.png', 0, 0, 0);
	});

	test('is what getRasterTiles draws for an image source', async () => {
		const tiles = await getRasterTiles(makeJob(RECTANGLE), 'img', loadImage);
		expect(tiles).toHaveLength(1);
	});

	test('draws a lon/lat rectangle on a north-up map as a rectangle', async () => {
		const job = makeJob(RECTANGLE);
		const [tile] = await getImageSourceTiles(job, 'img', loadImage);
		const p = new Projection({ width: 512, height: 512, center: [0, 0], zoom: 2 });
		const topLeft = p.project(...mercator(-10, 10));
		const bottomRight = p.project(...mercator(10, -10));
		expect(tile!.triangles).toBeUndefined();
		expect(tile!.x).toBeCloseTo(topLeft.x, 9);
		expect(tile!.y).toBeCloseTo(topLeft.y, 9);
		expect(tile!.width).toBeCloseTo(bottomRight.x - topLeft.x, 9);
		expect(tile!.height).toBeCloseTo(bottomRight.y - topLeft.y, 9);
		expect(tile!.dataUri).toMatch(/^data:image\/png;base64,/);
	});

	test('draws it on a turned map as two triangles, with no seam underlay', async () => {
		const projection = new Projection({
			width: 512,
			height: 512,
			center: [0, 0],
			zoom: 2,
			bearing: 30,
		});
		const [tile] = await getImageSourceTiles(makeJob(RECTANGLE, projection), 'img', loadImage);
		expect(tile!.standalone).toBe(true);
		expect(tile!.triangles).toHaveLength(2);
		const [first] = tile!.triangles!;
		const topRight = projection.project(...mercator(10, 10));
		expect(first!.source[1]).toEqual([1, 0]);
		expect(first!.target[1][0]).toBeCloseTo(topRight.x, 9);
		expect(first!.target[1][1]).toBeCloseTo(topRight.y, 9);
	});

	test('warps a quad that is no parallelogram over a finer mesh', async () => {
		const quad = [
			[-5, 10],
			[5, 10],
			[10, -10],
			[-10, -10],
		];
		const [tile] = await getImageSourceTiles(makeJob(quad), 'img', loadImage);
		expect(tile!.triangles).toHaveLength(16 * 16 * 2);
	});

	test('bends the image over the globe', async () => {
		const projection = new Projection({
			width: 512,
			height: 512,
			center: [0, 0],
			zoom: 1,
			globeness: 1,
		});
		const wide = [
			[-60, 60],
			[60, 60],
			[60, -60],
			[-60, -60],
		];
		const [tile] = await getImageSourceTiles(makeJob(wide, projection), 'img', loadImage);
		const triangles = tile!.triangles!;
		expect(triangles.length).toBeGreaterThan(2);
		// Every corner of the mesh is where the globe shows its point of the image.
		const [west, north] = mercator(-60, 60);
		const [east, south] = mercator(60, -60);
		for (const { source, target } of triangles) {
			for (let k = 0; k < 3; k++) {
				const [u, v] = source[k]!;
				const point = projection.project(west + (east - west) * u, north + (south - north) * v);
				expect(target[k]![0]).toBeCloseTo(point.x, 6);
				expect(target[k]![1]).toBeCloseTo(point.y, 6);
			}
		}
	});

	test('draws nothing when the image cannot be loaded', async () => {
		const tiles = await getImageSourceTiles(makeJob(RECTANGLE), 'img', () => Promise.resolve(null));
		expect(tiles).toEqual([]);
	});

	test.each([
		['without coordinates', undefined],
		['with three corners', RECTANGLE.slice(0, 3)],
		['with a corner that is no number', [...RECTANGLE.slice(0, 3), ['a', 0]]],
	])('throws on a source %s', async (_, coordinates) => {
		await expect(getImageSourceTiles(makeJob(coordinates), 'img', loadImage)).rejects.toThrow(
			'Invalid image source "img"',
		);
	});
});

describe('imageWarp', () => {
	const trapezoid: [[number, number], [number, number], [number, number], [number, number]] = [
		[0.4, 0.4],
		[0.6, 0.4],
		[0.7, 0.6],
		[0.3, 0.6],
	];

	test('puts the corners of the image on the corners of the quad', () => {
		const at = imageWarp(trapezoid);
		expect(at(0, 0)).toEqual([0.4, 0.4]);
		const [x1, y1] = at(1, 0);
		expect(x1).toBeCloseTo(0.6, 12);
		expect(y1).toBeCloseTo(0.4, 12);
		const [x2, y2] = at(1, 1);
		expect(x2).toBeCloseTo(0.7, 12);
		expect(y2).toBeCloseTo(0.6, 12);
		const [x3, y3] = at(0, 1);
		expect(x3).toBeCloseTo(0.3, 12);
		expect(y3).toBeCloseTo(0.6, 12);
	});

	test('maps a trapezoid projectively: the image center to where the diagonals cross', () => {
		// The diagonals (0.4, 0.4)–(0.7, 0.6) and (0.6, 0.4)–(0.3, 0.6) cross at 1/3 of the way
		// down, as the top is half as long as the bottom.
		const [x, y] = imageWarp(trapezoid)(0.5, 0.5);
		expect(x).toBeCloseTo(0.5, 12);
		expect(y).toBeCloseTo(0.4 + 0.2 / 3, 12);
	});

	test('maps a parallelogram affinely', () => {
		const at = imageWarp([
			[0.4, 0.4],
			[0.6, 0.4],
			[0.7, 0.6],
			[0.5, 0.6],
		]);
		const [x, y] = at(0.25, 0.5);
		expect(x).toBeCloseTo(0.4 + 0.05 + 0.05, 12);
		expect(y).toBeCloseTo(0.5, 12);
	});
});
