import { describe, expect, test } from 'vitest';
import { closingLength, dashOffset, dashPattern } from './line_dash.js';

describe('dashPattern', () => {
	test('measures the dashes in line widths', () => {
		expect(dashPattern([2, 1], 3, 12)).toEqual({ lengths: [6, 3], offset: 0 });
	});

	test("scales them with the map from the zoom level's integer part", () => {
		const dash = dashPattern([2, 1], 3, 12.5)!;
		expect(dash.lengths[0]).toBeCloseTo(6 * Math.SQRT2);
		expect(dash.lengths[1]).toBeCloseTo(3 * Math.SQRT2);
	});

	test('joins the last dash of an odd number of values to the first', () => {
		// dash 3, gap 1, dash 1, dash 3, gap 1, …: dashes of 4, starting 1 into the first.
		expect(dashPattern([3, 1, 1], 1, 10)).toEqual({ lengths: [4, 1], offset: 1 });
	});

	test('is undefined for a line without dashes or gaps', () => {
		expect(dashPattern(undefined, 2, 10)).toBeUndefined();
		expect(dashPattern([], 2, 10)).toBeUndefined();
		expect(dashPattern([2], 2, 10)).toBeUndefined();
		expect(dashPattern([2, 0], 2, 10)).toBeUndefined();
		// A line that has no width at the zoom level's integer part.
		expect(dashPattern([2, 1], 0, 10.5)).toBeUndefined();
	});
});

describe('dashOffset', () => {
	const dash = { lengths: [3, 1.5], offset: 0 };

	test('is how far into the pattern a line starts', () => {
		expect(dashOffset(dash, 0)).toBe(0);
		expect(dashOffset(dash, 2)).toBe(2);
		expect(dashOffset(dash, 10)).toBeCloseTo(1);
	});

	test("adds the pattern's own offset", () => {
		expect(dashOffset({ lengths: [4, 1], offset: 1 }, 3)).toBe(4);
		expect(dashOffset({ lengths: [4, 1], offset: 1 }, 4.5)).toBeCloseTo(0.5);
	});
});

describe('closingLength', () => {
	test("is the length of a ring's closing segment", () => {
		expect(
			closingLength([
				{ x: 0, y: 0 },
				{ x: 40, y: 0 },
				{ x: 40, y: 30 },
			]),
		).toBe(50);
		expect(closingLength([])).toBe(0);
	});
});
