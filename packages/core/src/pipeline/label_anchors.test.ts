import { describe, expect, test } from 'vitest';
import { Feature, Point2D } from '../geometry.js';
import { classifyRings, labelAnchors, poleOfInaccessibility } from './label_anchors.js';

type XY = [number, number];

const ring = (points: XY[]): Point2D[] => points.map(([x, y]) => new Point2D(x, y));
const xy = (points: Point2D[]): XY[] => points.map((p) => [p.x, p.y]);

/** A square ring, clockwise on screen (y down), or counterclockwise if `reverse`. */
function square(x: number, y: number, size: number, reverse = false): Point2D[] {
	const points: XY[] = [
		[x, y],
		[x + size, y],
		[x + size, y + size],
		[x, y + size],
		[x, y],
	];
	return ring(reverse ? points.reverse() : points);
}

function feature(type: 'Point' | 'LineString' | 'Polygon', geometry: Point2D[][]): Feature {
	return new Feature({ type, geometry, properties: {} });
}

describe('labelAnchors', () => {
	test('places a symbol at every point', () => {
		const points = feature('Point', [ring([[1, 2]]), ring([[3, 4]])]);
		expect(xy(labelAnchors(points))).toEqual([
			[1, 2],
			[3, 4],
		]);
	});

	test('places a symbol at the first vertex of every line, as MapLibre does', () => {
		const lines = feature('LineString', [
			ring([
				[0, 0],
				[50, 50],
				[100, 0],
			]),
			ring([
				[7, 8],
				[9, 9],
			]),
			[],
		]);
		expect(xy(labelAnchors(lines))).toEqual([
			[0, 0],
			[7, 8],
		]);
	});

	test('places a symbol in the middle of a square', () => {
		const [anchor] = labelAnchors(feature('Polygon', [square(0, 0, 100)]));
		expect(anchor!.x).toBeCloseTo(50, 0);
		expect(anchor!.y).toBeCloseTo(50, 0);
	});

	test('places one symbol per polygon of a multipolygon, with either winding', () => {
		for (const reverse of [false, true]) {
			const anchors = labelAnchors(
				feature('Polygon', [square(0, 0, 100, reverse), square(200, 0, 50, reverse)]),
			);
			expect(anchors).toHaveLength(2);
			expect(anchors[0]!.x).toBeCloseTo(50, 0);
			expect(anchors[1]!.x).toBeCloseTo(225, 0);
		}
	});
});

describe('labelAnchors along lines', () => {
	test('places one label in the middle of the longest line, measured along it', () => {
		const street = feature('LineString', [
			ring([
				[0, 0],
				[10, 0],
			]),
			ring([
				[0, 100],
				[60, 100],
				[60, 140],
			]),
		]);
		for (const placement of ['line', 'line-center']) {
			expect(xy(labelAnchors(street, placement))).toEqual([[50, 100]]);
		}
	});

	test('places a polygon on its longest ring, like a line', () => {
		expect(xy(labelAnchors(feature('Polygon', [square(0, 0, 100)]), 'line'))).toEqual([[100, 100]]);
	});

	test('still places points at every point', () => {
		const points = feature('Point', [ring([[1, 2]]), ring([[3, 4]])]);
		expect(labelAnchors(points, 'line')).toHaveLength(2);
	});
});

describe('classifyRings', () => {
	test('groups holes with the outer ring before them', () => {
		const outer = square(0, 0, 100);
		const hole = square(40, 40, 20, true);
		const other = square(200, 0, 10);
		expect(classifyRings([outer, hole, other])).toEqual([[outer, hole], [other]]);
	});

	test('leaves out rings without area', () => {
		const flat = ring([
			[0, 0],
			[10, 0],
			[0, 0],
		]);
		expect(classifyRings([flat, square(0, 0, 10)])).toEqual([[square(0, 0, 10)]]);
		expect(classifyRings([flat])).toEqual([]);
	});
});

describe('poleOfInaccessibility', () => {
	test('stays inside a concave polygon, where its centroid is not', () => {
		// A "U": the centroid of the outline lies in the notch, outside the polygon.
		const u = ring([
			[0, 0],
			[30, 0],
			[30, 90],
			[70, 90],
			[70, 0],
			[100, 0],
			[100, 100],
			[0, 100],
			[0, 0],
		]);
		const pole = poleOfInaccessibility([u], 1);
		const inLeftArm = pole.x <= 30;
		const inRightArm = pole.x >= 70;
		const inBase = pole.y >= 90;
		expect(inLeftArm || inRightArm || inBase).toBe(true);
	});

	test('avoids a hole', () => {
		const pole = poleOfInaccessibility([square(0, 0, 100), square(25, 25, 50, true)], 1);
		const inHole = pole.x > 25 && pole.x < 75 && pole.y > 25 && pole.y < 75;
		expect(inHole).toBe(false);
	});

	test('returns a corner of a polygon without area', () => {
		const line = ring([
			[5, 5],
			[50, 5],
			[5, 5],
		]);
		expect(xy([poleOfInaccessibility([line], 1)])).toEqual([[5, 5]]);
	});
});
