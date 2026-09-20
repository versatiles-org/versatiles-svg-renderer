import { describe, expect, test } from 'vitest';
import { mapIconAnchor, mapTextAnchor } from './anchors.js';

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
