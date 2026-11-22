import { describe, expect, test } from 'vitest';
import { haloStroke, mapIconAnchor, mapTextAnchor } from './anchors.js';

describe('mapTextAnchor', () => {
	test.each([
		['left', 'start', 'central'],
		['right', 'end', 'central'],
		['top', 'middle', 'text-before-edge'],
		['bottom', 'middle', 'text-after-edge'],
		['top-left', 'start', 'text-before-edge'],
		['top-right', 'end', 'text-before-edge'],
		['bottom-left', 'start', 'text-after-edge'],
		['bottom-right', 'end', 'text-after-edge'],
		['center', 'middle', 'central'],
		['anything else', 'middle', 'central'],
	])('%s anchors the text %s / %s', (anchor, align, baseline) => {
		expect(mapTextAnchor(anchor)).toEqual([align, baseline]);
	});
});

describe('mapIconAnchor', () => {
	// The offset moves the icon's top-left corner so the named part of a 10x20 icon lands
	// on the point.
	test.each([
		['left', [0, -10]],
		['right', [-10, -10]],
		['top', [-5, 0]],
		['bottom', [-5, -20]],
		['top-left', [0, 0]],
		['top-right', [-10, 0]],
		['bottom-left', [0, -20]],
		['bottom-right', [-10, -20]],
		['center', [-5, -10]],
		['anything else', [-5, -10]],
	])('%s offsets the icon by %s', (anchor, offset) => {
		expect(mapIconAnchor(anchor, 10, 20)).toEqual(offset);
	});
});

describe('haloStroke', () => {
	test('reaches the halo width beyond the outline: a stroke twice as wide', () => {
		expect(haloStroke(2, 24)).toBe(4);
		expect(haloStroke(0, 24)).toBe(0);
	});

	test('reaches no further than the glyphs do, 3 of 24 px per em', () => {
		expect(haloStroke(6, 24)).toBe(6);
		expect(haloStroke(2, 12)).toBe(3);
	});
});
