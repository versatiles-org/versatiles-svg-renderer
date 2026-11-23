import { describe, expect, test } from 'vitest';
import { Point2D } from '../../geo/index.js';
import type { GlyphPlacement } from '../../types.js';
import {
	fitsMaxAngle,
	layoutAlongLine,
	layoutVertically,
	lineAnchors,
	measureLine,
	pointAt,
	runsVertically,
} from './line_labels.js';

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
	const short = line([
		[0, 0],
		[60, 0],
	]);
	/** Anchors for a label `labelLength` long, two ems of 10 px beyond its half, every 250 px. */
	const anchors = (
		l: ReturnType<typeof line>,
		labelLength: number,
		options: Partial<Parameters<typeof lineAnchors>[2]> = {},
		placement = 'line',
	) =>
		lineAnchors(l, placement, {
			labelLength,
			spacing: 250,
			extraOffset: 20,
			continued: false,
			overscaling: 1,
			...options,
		});

	test('repeats anchors every `spacing` pixels where the label fits', () => {
		// First anchor: (50 / 2 + 2 × 10) % 250 = 45.
		expect(anchors(straight, 50)).toEqual([45, 295, 545, 795]);
	});

	test('gives a long label more room', () => {
		// 250 - 220 < 250 / 4: the spacing grows to 220 + 62.5.
		expect(anchors(straight, 220)).toEqual([130, 412.5, 695]);
	});

	test('starts half the spacing in on a line that goes on from the next tile', () => {
		expect(anchors(straight, 50, { continued: true })).toEqual([125, 375, 625, 875]);
	});

	test('lays out a tile shown beyond its zoom as the tile it comes from', () => {
		// Twice the offset, (50 / 2 + 20) × 2 = 90; half the spacing twice is the spacing: 0.
		expect(anchors(straight, 50, { overscaling: 2 })).toEqual([90, 340, 590, 840]);
		expect(anchors(straight, 50, { continued: true, overscaling: 2 })).toEqual([250, 500, 750]);
	});

	test('places one in the middle where none fits at the spacing, unless the line goes on', () => {
		expect(anchors(short, 50)).toEqual([30]);
		expect(anchors(short, 50, { continued: true })).toEqual([]);
		// Also where the line bends too much at every place but the middle.
		expect(anchors(straight, 50, { accept: (d) => d === 500 })).toEqual([500]);
		expect(anchors(straight, 50, { accept: (d) => d === 295 })).toEqual([295]);
	});

	test('places none on a line shorter than the label', () => {
		expect(anchors(short, 70)).toEqual([]);
	});

	test('places only the middle one for line-center', () => {
		expect(anchors(straight, 50, {}, 'line-center')).toEqual([500]);
		expect(anchors(straight, 50, { accept: () => false }, 'line-center')).toEqual([]);
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

describe('runsVertically', () => {
	const at = (x: number, y: number, angle = 0) => ({ text: 'a', x, y, angle });

	test('compares how far the label runs down with how far across', () => {
		expect(runsVertically([at(0, 0), at(10, 11)])).toBe(true);
		expect(runsVertically([at(0, 0), at(-11, -10)])).toBe(false);
		expect(runsVertically([])).toBe(false);
	});

	test('takes the angle of a single glyph', () => {
		expect(runsVertically([at(0, 0, 100)])).toBe(true);
		expect(runsVertically([at(0, 0, 170)])).toBe(false);
	});
});

describe('layoutVertically', () => {
	const southward = line([
		[0, 0],
		[0, 100],
	]);
	const northward = line([
		[0, 100],
		[0, 0],
	]);

	test('reads from the top, upright characters one em long and turned upright', () => {
		for (const l of [southward, northward]) {
			const glyphs = layoutVertically(l, 50, ['北', 'x'], [24, 10], [true, false], [0, 0], 24);
			const normalized = rounded(glyphs).map((g) => ({
				...g,
				x: g.x + 0,
				angle: (g.angle + 360) % 360,
			}));
			expect(normalized).toEqual([
				// 2/24 em above the middle of its place, from 33 to 57
				{ text: '北', x: 0, y: 43, angle: 0 },
				// on its side, its top to the right
				{ text: 'x', x: 0, y: 62, angle: 90 },
			]);
		}
	});

	test('moves the label by its offset: along the line, and across it', () => {
		const glyphs = layoutVertically(southward, 50, ['北'], [24], [true], [5, 3], 24);
		expect(rounded(glyphs)).toEqual([{ text: '北', x: -3, y: 53, angle: 0 }]);
	});
});
