import { describe, expect, test } from 'vitest';
import { traceContours, traceGlyph, traceHalo } from './glyph_outline.js';
import { rectangleSdf } from '../../sources/__fixtures__/glyphs.js';

/** The bounding box of rings. */
const bounds = (rings: [number, number][][]) => {
	const xs = rings.flat().map(([x]) => x);
	const ys = rings.flat().map(([, y]) => y);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(
		(v) => Math.round(v * 10) / 10 + 0, // + 0: no −0
	);
};

describe('traceContours', () => {
	test('traces a filled rectangle as one ring along its outline', () => {
		const rings = traceContours(rectangleSdf(10, 6), 16, 12);
		expect(rings).toHaveLength(1);
		// The rectangle lies inside the 3 px border: from (3, 3) to (13, 9).
		expect(bounds(rings)).toEqual([3, 3, 13, 9]);
	});

	test('traces a hole as a ring of its own', () => {
		// A 20 × 20 square with a 6 × 6 hole: the field inside the hole falls below the edge.
		const w = 26;
		const values = rectangleSdf(20, 20);
		const hole = rectangleSdf(6, 6);
		for (let j = 0; j < 12; j++) {
			for (let i = 0; i < 12; i++) {
				// The hole's field, turned around, centered in the square.
				const k = (j + 7) * w + (i + 7);
				values[k] = Math.min(values[k]!, 255 - hole[j * 12 + i]! + 127);
			}
		}
		expect(traceContours(values, w, w)).toHaveLength(2);
	});

	test('traces nothing in an empty field', () => {
		expect(traceContours(new Uint8Array(36), 6, 6)).toEqual([]);
	});
});

describe('traceGlyph', () => {
	test("places the outline in MapLibre's glyph frame", () => {
		const glyph = {
			id: 65,
			bitmap: rectangleSdf(10, 12),
			width: 10,
			height: 12,
			left: 1,
			top: -5,
			advance: 14,
		};
		const outline = traceGlyph(glyph, 'F\u000065');
		expect(outline.key).toBe('F\u000065');
		expect(outline.advance).toBeCloseTo(14 / 24);
		// x from the middle of the advance: left − 7 = −6 to −6 + 10 = 4;
		// y from the middle of the line: −17 − top = −12 to −12 + 12 = 0.
		expect(bounds(outline.rings)).toEqual([-6, -12, 4, 0]);
	});

	test('keeps a glyph without a shape, such as a space, with its advance', () => {
		const space = {
			id: 32,
			bitmap: new Uint8Array(0),
			width: 0,
			height: 0,
			left: 0,
			top: 0,
			advance: 6,
		};
		expect(traceGlyph(space, 's')).toEqual({ key: 's', rings: [], advance: 0.25 });
		expect(traceHalo(space, 's', 2)).toEqual({ key: 's', rings: [], advance: 0.25 });
	});
});

describe('traceHalo', () => {
	// A 10 × 12 rectangle; its outline spans [−6, −12, 4, 0] (see above), its bitmap 3 px more.
	const glyph = {
		id: 65,
		bitmap: rectangleSdf(10, 12),
		width: 10,
		height: 12,
		left: 1,
		top: -5,
		advance: 14,
	};

	test('without a width, traces the outline of the glyph itself', () => {
		expect(traceHalo(glyph, 'h', 0).rings).toEqual(traceGlyph(glyph, 'g').rings);
	});

	test("traces where the field exceeds MapLibre's halo edge, (6 − width) / 8", () => {
		// Width 1: the edge 255 / 8 lower, which the test field (24 per pixel) reaches 255 / 8 / 24
		// pixels beyond the rectangle's outline.
		const beyond = 255 / 8 / 24;
		const [x0, y0, x1, y1] = bounds(traceHalo(glyph, 'h', 1).rings);
		expect(x0).toBeCloseTo(-6 - beyond, 1);
		expect(y0).toBeCloseTo(-12 - beyond, 1);
		expect(x1).toBeCloseTo(4 + beyond, 1);
		expect(y1).toBeCloseTo(0 + beyond, 1);
	});

	test('fills the bitmap and its pixel of padding, no further, when the halo is wider than the field', () => {
		// Width 4.5: the field ends 3 px beyond the outline, at the bitmap's edge, before the halo
		// does. The halo fades into the padding.
		const [x0, y0, x1, y1] = bounds(traceHalo(glyph, 'h', 4.5).rings);
		expect(x0).toBeLessThan(-9);
		expect(x0).toBeGreaterThan(-10);
		expect(y0).toBeLessThan(-15);
		expect(y1).toBeGreaterThan(3);
		expect(x1).toBeLessThan(8);
		// Width 6 or more: all of it, a box.
		const box = traceHalo(glyph, 'h', 8);
		expect(box.key).toBe('h');
		expect(box.rings).toEqual([
			[
				[-10, -16],
				[8, -16],
				[8, 4],
				[-10, 4],
			],
		]);
	});
});
