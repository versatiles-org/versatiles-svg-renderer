import { describe, expect, test } from 'vitest';
import { Point2D, Feature } from './geometry.js';

describe('Point2D', () => {
	test('constructor sets x and y', () => {
		const p = new Point2D(3, 4);
		expect(p.x).toBe(3);
		expect(p.y).toBe(4);
	});

	test('isZero returns true for origin', () => {
		expect(new Point2D(0, 0).isZero()).toBe(true);
	});

	test('isZero returns false for non-origin', () => {
		expect(new Point2D(1, 0).isZero()).toBe(false);
		expect(new Point2D(0, 1).isZero()).toBe(false);
	});

	test('scale multiplies both coordinates', () => {
		const p = new Point2D(3, 4);
		const result = p.scale(2);
		expect(p.x).toBe(6);
		expect(p.y).toBe(8);
		expect(result).toBe(p);
	});

	test('translate adds offset', () => {
		const p = new Point2D(1, 2);
		const offset = new Point2D(10, 20);
		const result = p.translate(offset);
		expect(p.x).toBe(11);
		expect(p.y).toBe(22);
		expect(result).toBe(p);
	});

	test('getProject2Pixel converts lng/lat to pixel coordinates', () => {
		const p = new Point2D(0, 0);
		const pixel = p.getProject2Pixel();
		expect(pixel.x).toBeCloseTo(0.5, 10);
		expect(pixel.y).toBeCloseTo(0.5, 10);
	});

	test('getProject2Pixel does not mutate original', () => {
		const p = new Point2D(10, 20);
		p.getProject2Pixel();
		expect(p.x).toBe(10);
		expect(p.y).toBe(20);
	});
});

describe('Feature', () => {
	function makeFeature(
		points: [number, number][][],
		type: 'Polygon' | 'LineString' = 'Polygon',
	): Feature {
		return new Feature({
			type,
			id: 1,
			properties: { name: 'test' },
			geometry: points.map((ring) => ring.map(([x, y]) => new Point2D(x, y))),
		});
	}

	test('constructor sets fields', () => {
		const f = makeFeature([
			[
				[0, 0],
				[10, 10],
			],
		]);
		expect(f.type).toBe('Polygon');
		expect(f.id).toBe(1);
		expect(f.properties).toEqual({ name: 'test' });
		expect(f.geometry).toHaveLength(1);
	});

	test('getBbox returns bounding box', () => {
		const f = makeFeature([
			[
				[1, 2],
				[5, 8],
				[3, 4],
			],
		]);
		expect(f.getBbox()).toEqual([1, 2, 5, 8]);
	});

	test('getBbox spans multiple rings', () => {
		const f = makeFeature([
			[
				[0, 0],
				[5, 5],
			],
			[
				[10, 10],
				[15, 15],
			],
		]);
		expect(f.getBbox()).toEqual([0, 0, 15, 15]);
	});

	test('doesOverlap returns true for overlapping bbox', () => {
		const f = makeFeature([
			[
				[0, 0],
				[10, 10],
			],
		]);
		expect(f.doesOverlap([5, 5, 15, 15])).toBe(true);
	});

	test('doesOverlap returns false when feature is entirely right of bbox', () => {
		const f = makeFeature([
			[
				[20, 0],
				[30, 10],
			],
		]);
		expect(f.doesOverlap([0, 0, 10, 10])).toBe(false);
	});

	test('doesOverlap returns false when feature is entirely below bbox', () => {
		const f = makeFeature([
			[
				[0, 20],
				[10, 30],
			],
		]);
		expect(f.doesOverlap([0, 0, 10, 10])).toBe(false);
	});

	test('doesOverlap returns false when feature is entirely left of bbox', () => {
		const f = makeFeature([
			[
				[0, 0],
				[5, 5],
			],
		]);
		expect(f.doesOverlap([10, 0, 20, 10])).toBe(false);
	});

	test('doesOverlap returns false when feature is entirely above bbox', () => {
		const f = makeFeature([
			[
				[0, 0],
				[5, 5],
			],
		]);
		expect(f.doesOverlap([0, 10, 10, 20])).toBe(false);
	});
});
