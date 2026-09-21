import { describe, expect, test } from 'vitest';
import { offsetSegmentPoints } from './svg_path.js';

describe('offsetSegmentPoints', () => {
	test('returns the input unchanged when offset is 0', () => {
		const pts = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		];
		expect(offsetSegmentPoints(pts, 0)).toBe(pts);
	});

	test('returns the input unchanged for fewer than two points', () => {
		const pts = [{ x: 5, y: 5 }];
		expect(offsetSegmentPoints(pts, 3)).toBe(pts);
	});

	test('positive offset shifts an eastward line to the right (screen +y)', () => {
		// Travel is +x (east). Screen space is y-down, so the right-hand side is +y.
		const pts = [
			{ x: 0, y: 10 },
			{ x: 20, y: 10 },
		];
		const result = offsetSegmentPoints(pts, 5);
		expect(result[0]!.x).toBeCloseTo(0);
		expect(result[0]!.y).toBeCloseTo(15);
		expect(result[1]!.x).toBeCloseTo(20);
		expect(result[1]!.y).toBeCloseTo(15);
	});

	test('negative offset shifts an eastward line to the left (screen -y)', () => {
		const pts = [
			{ x: 0, y: 10 },
			{ x: 20, y: 10 },
		];
		const result = offsetSegmentPoints(pts, -5);
		expect(result[0]!.y).toBeCloseTo(5);
		expect(result[1]!.y).toBeCloseTo(5);
	});

	test('positive offset shifts a southward line to the right (screen -x)', () => {
		// Travel is +y (south, down). Right-hand side of that is -x (east on screen is +x, so right is west... )
		// Right-hand normal of (0, dy) is (-dy, dx)/len = (-1, 0) for dy>0 => -x.
		const pts = [
			{ x: 10, y: 0 },
			{ x: 10, y: 20 },
		];
		const result = offsetSegmentPoints(pts, 5);
		expect(result[0]!.x).toBeCloseTo(5);
		expect(result[1]!.x).toBeCloseTo(5);
	});

	test('places the miter at a right-angle corner', () => {
		// L-shape: east then south.
		const pts = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		];
		const result = offsetSegmentPoints(pts, 2);
		expect(result).toHaveLength(3);
		// First segment (east): right-hand normal (0, +1) => start moves to (0, 2).
		expect(result[0]!.x).toBeCloseTo(0);
		expect(result[0]!.y).toBeCloseTo(2);
		// Corner miter: normals (0,1) and (-1,0), bisector (-1,1)/√2, cosHalf = 1/√2.
		// scale = 2 / (1/√2) = 2√2; miter point = (10,0) + 2√2 * (-1,1)/√2 = (8, 2).
		expect(result[1]!.x).toBeCloseTo(8);
		expect(result[1]!.y).toBeCloseTo(2);
		// Last segment (south): right-hand normal (-1, 0) => end moves to (8, 10).
		expect(result[2]!.x).toBeCloseTo(8);
		expect(result[2]!.y).toBeCloseTo(10);
	});

	test('clamps the miter at a very sharp turn instead of spiking', () => {
		// Sharp V-turn back on itself.
		const pts = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 0, y: 1 },
		];
		const result = offsetSegmentPoints(pts, 2);
		const dist = Math.hypot(result[1]!.x - 10, result[1]!.y - 0);
		// Capped at ~4x the offset (cosHalf floored at 0.25) => <= 8.
		expect(dist).toBeLessThanOrEqual(8 + 1e-6);
	});

	test('reuses the previous normal for a zero-length segment', () => {
		const pts = [
			{ x: 0, y: 10 },
			{ x: 10, y: 10 },
			{ x: 10, y: 10 }, // duplicate => zero-length segment
			{ x: 20, y: 10 },
		];
		const result = offsetSegmentPoints(pts, 5);
		expect(result).toHaveLength(4);
		// All points stay on the same offset side (+y) without NaN.
		for (const p of result) {
			expect(Number.isFinite(p.x)).toBe(true);
			expect(Number.isFinite(p.y)).toBe(true);
			expect(p.y).toBeCloseTo(15);
		}
	});
});
