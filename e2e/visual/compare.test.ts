import { describe, expect, test } from 'vitest';
import { ceilingFor, fails, gate } from './compare.js';

describe('gate', () => {
	test('reports a region without a baseline as new, and passes it', () => {
		expect(gate(3, undefined)).toEqual({ kind: 'new' });
		expect(fails(gate(3, undefined))).toBe(false);
	});

	test('ignores changes within 10% or 0.1 points, whichever is more', () => {
		// Small values: the 0.1-point floor applies.
		expect(gate(0.19, 0.1).kind).toBe('same');
		expect(gate(0.21, 0.1).kind).toBe('worse');
		// Large values: 10% applies.
		expect(gate(4.3, 4).kind).toBe('same');
		expect(gate(4.5, 4).kind).toBe('worse');
		expect(gate(3.5, 4).kind).toBe('better');
	});

	test('fails on getting worse, and not on getting better', () => {
		expect(fails(gate(4.5, 4))).toBe(true);
		expect(fails(gate(3.5, 4))).toBe(false);
		expect(fails(gate(4, 4))).toBe(false);
	});

	test('fails above the ceiling: 1.5 × the baseline, or 0.5 points above it', () => {
		expect(ceilingFor(0.2)).toBe(0.7);
		expect(ceilingFor(4)).toBe(6);
		expect(gate(6.1, 4)).toEqual({ kind: 'over', base: 4, ceiling: 6 });
		expect(fails(gate(6.1, 4))).toBe(true);
	});
});
