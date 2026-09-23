import { describe, expect, test } from 'vitest';
import { Point2D } from '../geometry.js';
import type { GlyphPlacement } from '../renderer/types.js';
import { fitsMaxAngle, layoutAlongLine, lineAnchors, measureLine, pointAt } from './line_labels.js';

const line = (points: [number, number][]) => measureLine(points.map(([x, y]) => new Point2D(x, y)));
const round = (v: number): number => Math.round(v * 100) / 100;
const rounded = (glyphs: GlyphPlacement[]) =>
	glyphs.map((g) => ({ ...g, x: round(g.x), y: round(g.y), angle: round(g.angle) }));

describe('measureLine and pointAt', () => {
	const l = line([
		[0, 0],
		[30, 0],
		[30, 40],
	]);

	test('measures the distance of every vertex', () => {
		expect(l.distances).toEqual([0, 30, 70]);
		expect(l.length).toBe(70);
	});

	test('finds the point at a distance, with the direction of its segment', () => {
		expect(pointAt(l, 15)).toEqual({ x: 15, y: 0, angle: 0 });
		const down = pointAt(l, 50);
		expect([down.x, down.y, round(down.angle)]).toEqual([30, 20, round(Math.PI / 2)]);
	});
});

describe('lineAnchors', () => {
	const straight = line([
		[0, 0],
		[1000, 0],
	]);

	test('repeats anchors every `spacing` pixels where the label fits', () => {
		// First anchor: (50 / 2 + 2 × 10) % 250 = 45.
		expect(lineAnchors(straight, 50, 250, 10, 'line')).toEqual([45, 295, 545, 795]);
	});

	test('gives a long label more room', () => {
		// 250 - 220 < 250 / 4: the spacing grows to 220 + 62.5.
		expect(lineAnchors(straight, 220, 250, 10, 'line')).toEqual(
			[130, 412.5, 695, 977.5].filter((d) => d + 110 <= 1000),
		);
	});

	test('places one in the middle of a line too short for the spacing', () => {
		const short = line([
			[0, 0],
			[60, 0],
		]);
		expect(lineAnchors(short, 50, 250, 10, 'line')).toEqual([30]);
	});

	test('places none on a line shorter than the label', () => {
		expect(
			lineAnchors(
				line([
					[0, 0],
					[40, 0],
				]),
				50,
				250,
				10,
				'line',
			),
		).toEqual([]);
	});

	test('places only the middle one for line-center', () => {
		expect(lineAnchors(straight, 50, 250, 10, 'line-center')).toEqual([500]);
	});
});

describe('fitsMaxAngle', () => {
	const zigzag = line([
		[0, 0],
		[100, 0],
		[100, 100],
		[200, 100],
	]);

	test('accepts a label on a straight stretch', () => {
		expect(fitsMaxAngle(zigzag, 50, 40, 6, Math.PI / 4)).toBe(true);
	});

	test('rejects a label across a sharper bend than the maximum', () => {
		expect(fitsMaxAngle(zigzag, 100, 40, 6, Math.PI / 4)).toBe(false);
		expect(fitsMaxAngle(zigzag, 100, 40, 6, Math.PI)).toBe(true);
	});
});

describe('layoutAlongLine', () => {
	const eastward = line([
		[0, 0],
		[100, 0],
	]);

	test('places each glyph at its center along the line, turned with it', () => {
		const glyphs = layoutAlongLine(eastward, 50, ['a', 'b'], [10, 20], [0, 0], true);
		expect(rounded(glyphs)).toEqual([
			{ text: 'a', x: 40, y: 0, angle: 0 },
			{ text: 'b', x: 55, y: 0, angle: 0 },
		]);
	});

	test('keeps a label upright on a line running westward', () => {
		const westward = line([
			[100, 0],
			[0, 0],
		]);
		const glyphs = layoutAlongLine(westward, 50, ['a', 'b'], [10, 20], [0, 0], true);
		expect(glyphs.map((g) => [g.text, round(g.x), round(Math.abs(g.angle % 360))])).toEqual([
			['a', 40, 0],
			['b', 55, 0],
		]);
		// Without keep-upright, it reads westward, upside down.
		const upsideDown = layoutAlongLine(westward, 50, ['a', 'b'], [10, 20], [0, 0], false);
		expect(upsideDown.map((g) => [g.text, round(g.x), round(g.angle)])).toEqual([
			['a', 60, 180],
			['b', 45, 180],
		]);
	});

	test('moves the label by its offset: along the line, and to the right of it', () => {
		const glyphs = layoutAlongLine(eastward, 50, ['a'], [10], [5, 3], true);
		expect(rounded(glyphs)).toEqual([{ text: 'a', x: 55, y: 3, angle: 0 }]);
	});
});
