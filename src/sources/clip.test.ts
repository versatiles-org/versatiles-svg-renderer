import { describe, expect, test } from 'vitest';
import { clipLine, clipPolygon, clipPolygonOutline, exceedsSquare } from './clip.js';

const xy = (points: [number, number][]): { x: number; y: number }[] =>
	points.map(([x, y]) => ({ x, y }));
const plain = (lines: { x: number; y: number }[][]): [number, number][][] =>
	lines.map((line) => line.map(({ x, y }) => [x, y]));

describe('exceedsSquare', () => {
	test('detects points outside of the square', () => {
		expect(
			exceedsSquare(
				[
					xy([
						[0, 0],
						[10, 10],
					]),
				],
				0,
				10,
			),
		).toBe(false);
		expect(
			exceedsSquare(
				[
					xy([
						[0, 0],
						[11, 5],
					]),
				],
				0,
				10,
			),
		).toBe(true);
		expect(exceedsSquare([xy([[-1, 5]])], 0, 10)).toBe(true);
	});
});

describe('clipPolygon', () => {
	test('clips a ring reaching over the border', () => {
		const rings = clipPolygon(
			[
				xy([
					[5, 5],
					[15, 5],
					[15, 8],
					[5, 8],
				]),
			],
			0,
			10,
		);
		expect(plain(rings)).toEqual([
			[
				[5, 5],
				[10, 5],
				[10, 8],
				[5, 8],
			],
		]);
	});

	test('drops rings outside of the square', () => {
		expect(
			clipPolygon(
				[
					xy([
						[20, 20],
						[30, 20],
						[30, 30],
					]),
				],
				0,
				10,
			),
		).toEqual([]);
	});

	test('keeps rings inside of the square', () => {
		const ring = xy([
			[1, 1],
			[9, 1],
			[9, 9],
		]);
		expect(plain(clipPolygon([ring], 0, 10))).toEqual(plain([ring]));
	});
});

describe('clipPolygonOutline', () => {
	test('leaves out the edges along the border', () => {
		const lines = clipPolygonOutline(
			[
				xy([
					[5, 5],
					[15, 5],
					[15, 8],
					[5, 8],
					[5, 5],
				]),
			],
			0,
			10,
		);
		expect(plain(lines)).toEqual([
			[
				[5, 5],
				[10, 5],
			],
			[
				[10, 8],
				[5, 8],
				[5, 5],
			],
		]);
	});

	test('closes rings inside of the square', () => {
		const lines = clipPolygonOutline(
			[
				xy([
					[1, 1],
					[9, 1],
					[9, 9],
				]),
			],
			0,
			10,
		);
		expect(plain(lines)).toEqual([
			[
				[1, 1],
				[9, 1],
				[9, 9],
				[1, 1],
			],
		]);
	});
});

describe('clipLine', () => {
	test('splits a line that leaves and re-enters the square', () => {
		const parts = clipLine(
			xy([
				[2, 2],
				[12, 2],
				[12, 6],
				[2, 6],
			]),
			0,
			10,
		);
		expect(plain(parts)).toEqual([
			[
				[2, 2],
				[10, 2],
			],
			[
				[10, 6],
				[2, 6],
			],
		]);
	});

	test('drops a line outside of the square', () => {
		expect(
			clipLine(
				xy([
					[12, 2],
					[15, 2],
				]),
				0,
				10,
			),
		).toEqual([]);
	});
});
