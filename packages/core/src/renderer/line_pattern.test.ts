import { describe, expect, test } from 'vitest';
import { linePatternStrips, patternPeriod, type Matrix } from './line_pattern.js';

/** Where the frame's point (s, t) lies on the screen. */
function apply([a, b, c, d, e, f]: Matrix, s: number, t: number): [number, number] {
	return [a * s + c * t + e, b * s + d * t + f];
}

describe('linePatternStrips', () => {
	test('runs the frame along an eastward line, the image top on its south side', () => {
		const [strip] = linePatternStrips(
			[
				{ x: 10, y: 50 },
				{ x: 110, y: 50 },
			],
			false,
			20,
		);
		// s = 0 at the line's start; t = 0 on the side of its normal (south, screen +y).
		expect(apply(strip!.matrix, 0, 0)).toEqual([10, 60]);
		expect(apply(strip!.matrix, 0, 20)).toEqual([10, 40]);
		expect(apply(strip!.matrix, 100, 10)).toEqual([110, 50]);
	});

	test('continues the distance from segment to segment', () => {
		const strips = linePatternStrips(
			[
				{ x: 0, y: 0 },
				{ x: 30, y: 0 },
				{ x: 30, y: 40 },
			],
			false,
			10,
		);
		expect(strips).toHaveLength(2);
		// The second segment starts 30 px along the line, at its corner, going south.
		const [x, y] = apply(strips[1]!.matrix, 30, 5);
		expect(x).toBeCloseTo(30, 9);
		expect(y).toBeCloseTo(0, 9);
		const [x2, y2] = apply(strips[1]!.matrix, 70, 5);
		expect(x2).toBeCloseTo(30, 9);
		expect(y2).toBeCloseTo(40, 9);
	});

	test('meets the next segment on the bisector of the join', () => {
		const strips = linePatternStrips(
			[
				{ x: 0, y: 0 },
				{ x: 30, y: 0 },
				{ x: 30, y: 40 },
			],
			false,
			10,
		);
		// The end of the first polygon and the start of the second are the same screen points.
		const [first, second] = strips.map(({ matrix, polygon }) =>
			polygon.map(([s, t]) => apply(matrix, s, t)),
		);
		const [, endLeft, endRight] = first!;
		const [startLeft, , , startRight] = second!;
		for (const [a, b] of [
			[endLeft!, startLeft!],
			[endRight!, startRight!],
		] as const) {
			expect(a[0]).toBeCloseTo(b[0], 9);
			expect(a[1]).toBeCloseTo(b[1], 9);
		}
	});

	test('reaches past the ends of an open line, for its caps', () => {
		const [strip] = linePatternStrips(
			[
				{ x: 0, y: 0 },
				{ x: 50, y: 0 },
			],
			false,
			10,
		);
		const along = strip!.polygon.map(([s]) => s);
		expect(Math.min(...along)).toBeLessThanOrEqual(-5);
		expect(Math.max(...along)).toBeGreaterThanOrEqual(55);
	});

	test('measures a ring from its last vertex, as MapLibre does', () => {
		const square = [
			{ x: 0, y: 0 },
			{ x: 40, y: 0 },
			{ x: 40, y: 40 },
			{ x: 0, y: 40 },
			{ x: 0, y: 0 },
		];
		const strips = linePatternStrips(square, true, 10);
		// Four sides, the closing one included; the first vertex is 40 px along.
		expect(strips).toHaveLength(4);
		const [x, y] = apply(strips[0]!.matrix, 40, 5);
		expect(x).toBeCloseTo(0, 9);
		expect(y).toBeCloseTo(0, 9);
	});

	test('skips repeated points, and draws nothing for a single point', () => {
		expect(
			linePatternStrips(
				[
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
				],
				false,
				4,
			),
		).toHaveLength(1);
		expect(linePatternStrips([{ x: 0, y: 0 }], false, 4)).toEqual([]);
	});
});

describe('patternPeriod', () => {
	test('scales the image to the line width, keeping its aspect ratio', () => {
		expect(patternPeriod(48, 40, 20, 12)).toBe(24);
	});

	test('grows with the map from the zoom level’s integer part', () => {
		expect(patternPeriod(48, 40, 20, 12.5)).toBeCloseTo(24 * Math.SQRT2, 9);
	});
});
