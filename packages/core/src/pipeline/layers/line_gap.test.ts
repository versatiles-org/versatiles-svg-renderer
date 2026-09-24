import { describe, expect, test } from 'vitest';
import { Point2D } from '../../geometry.js';
import { gapBands } from './line_gap.js';

const line = (...points: [number, number][]) => points.map(([x, y]) => new Point2D(x, y));
const xy = (points: Point2D[]) => points.map((p) => [round(p.x), round(p.y)]);
const round = (v: number): number => Math.round(v * 100) / 100 + 0;
const style = {
	shift: 8,
	offset: 0,
	cap: 'butt' as const,
	join: 'round' as const,
	roundLimit: 1.05,
};

describe('gapBands', () => {
	test('draws a band on each side of a straight line', () => {
		const { open, closed } = gapBands([line([0, 0], [100, 0])], false, style);
		expect(open.map(xy)).toEqual([
			[
				[0, -8],
				[100, -8],
			],
			[
				[0, 8],
				[100, 8],
			],
		]);
		expect(closed).toEqual([]);
	});

	test('joins the bands around a round end', () => {
		const { open, closed } = gapBands([line([0, 0], [100, 0])], false, {
			...style,
			cap: 'round',
		});
		expect(open).toEqual([]);
		expect(closed).toHaveLength(1);
		const ring = xy(closed[0]!);
		// It runs around both ends, at the band's distance.
		expect(ring).toContainEqual([108, 0]);
		expect(ring).toContainEqual([-8, 0]);
	});

	test('joins the bands across a square end, half the line width beyond it', () => {
		const { open, closed } = gapBands([line([0, 0], [100, 0])], false, {
			...style,
			cap: 'square',
		});
		// One ring: along the left band, across the end, back along the right one, across the start.
		expect(closed.map(xy)).toEqual([
			[
				[0, -8],
				[100, -8],
				[108, -8],
				[108, 8],
				[100, 8],
				[0, 8],
				[-8, 8],
				[-8, -8],
			],
		]);
		expect(open).toEqual([]);
	});

	test('rounds the outer side of a round join and mitres its inner side', () => {
		// A right angle: miter length √2, between the round limit and 2.
		const { open } = gapBands([line([0, 0], [100, 0], [100, 100])], false, style);
		const [left, right] = open.map(xy);
		// The left band is outside the turn: an arc around the corner.
		const corner = left!.slice(1, -1);
		expect(corner.length).toBeGreaterThan(2);
		for (const [x, y] of corner) expect(round(Math.hypot(x! - 100, y! - 0))).toBe(8);
		// The right band is inside it: the miter point.
		expect(right).toEqual([
			[0, 8],
			[92, 8],
			[92, 100],
		]);
	});

	test('mitres a turn below the round limit', () => {
		const { open } = gapBands([line([0, 0], [100, 0], [200, 10])], false, {
			...style,
			roundLimit: 2,
		});
		expect(open.map((band) => band.length)).toEqual([3, 3]);
	});

	test('mitres every join that is not round', () => {
		const { open } = gapBands([line([0, 0], [100, 0], [100, 100])], false, {
			...style,
			join: 'miter',
		});
		expect(open.map(xy)).toEqual([
			[
				[0, -8],
				[108, -8],
				[108, 100],
			],
			[
				[0, 8],
				[92, 8],
				[92, 100],
			],
		]);
	});

	test('splits a sharp round join into two round caps, as MapLibre does', () => {
		// A turn of about 160°: each segment's bands run on to the vertex and curve around it.
		const { open, closed } = gapBands([line([0, 0], [100, 0], [0, 30])], false, style);
		expect(closed).toEqual([]);
		expect(open).toHaveLength(2);
		const [first, second] = open.map(xy);
		// The first piece: along its left band, around the vertex, back along its right band.
		expect(first![0]).toEqual([0, -8]);
		expect(first).toContainEqual([108, 0]);
		expect(first![first!.length - 1]).toEqual([0, 8]);
		// The second piece starts with its own cap around the same vertex.
		expect(second!.every(([x]) => x! <= 108)).toBe(true);
		expect(second).toHaveLength(first!.length);
	});

	test('draws each band of a polygon ring as a ring', () => {
		const square = line([0, 0], [100, 0], [100, 100], [0, 100], [0, 0]);
		const { open, closed } = gapBands([square], true, { ...style, join: 'miter' });
		expect(open).toEqual([]);
		expect(closed.map(xy)).toEqual([
			[
				[-8, -8],
				[108, -8],
				[108, 108],
				[-8, 108],
			],
			[
				[8, 8],
				[92, 8],
				[92, 92],
				[8, 92],
			],
		]);
	});

	test('moves the bands with the line offset', () => {
		const { open } = gapBands([line([0, 0], [100, 0])], false, { ...style, offset: 5 });
		expect(open.map(xy)).toEqual([
			[
				[0, -3],
				[100, -3],
			],
			[
				[0, 13],
				[100, 13],
			],
		]);
	});
});
