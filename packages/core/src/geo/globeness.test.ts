import { describe, expect, test } from 'vitest';
import { getGlobeness } from './globeness.js';

describe('getGlobeness', () => {
	test('mercator and missing projection', () => {
		expect(getGlobeness(undefined, 3)).toBe(0);
		expect(getGlobeness({ type: 'mercator' }, 3)).toBe(0);
	});

	test('vertical-perspective', () => {
		expect(getGlobeness({ type: 'vertical-perspective' }, 15)).toBe(1);
	});

	test('globe transitions to mercator between zoom 11 and 12', () => {
		expect(getGlobeness({ type: 'globe' }, 5)).toBe(1);
		expect(getGlobeness({ type: 'globe' }, 11)).toBe(1);
		expect(getGlobeness({ type: 'globe' }, 11.25)).toBeCloseTo(0.75);
		expect(getGlobeness({ type: 'globe' }, 12)).toBe(0);
		expect(getGlobeness({ type: 'globe' }, 16)).toBe(0);
	});

	test('step and interpolate expressions', () => {
		const step = { type: ['step', ['zoom'], 'vertical-perspective', 6, 'mercator'] };
		expect(getGlobeness(step as never, 5)).toBe(1);
		expect(getGlobeness(step as never, 6)).toBe(0);
		const interpolate = {
			type: ['interpolate', ['linear'], ['zoom'], 2, 'mercator', 4, 'vertical-perspective'],
		};
		expect(getGlobeness(interpolate as never, 3)).toBeCloseTo(0.5);
	});
});
