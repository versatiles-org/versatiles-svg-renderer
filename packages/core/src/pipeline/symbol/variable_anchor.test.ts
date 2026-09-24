import { describe, expect, test } from 'vitest';
import { anchorOffsets, radialOffset } from './variable_anchor.js';

/** MapLibre's baseline shift, in ems. */
const B = 7 / 24;

describe('radialOffset', () => {
	test('moves a label away from its point, towards the side of its anchor', () => {
		expect(radialOffset('left', 2)).toEqual([2, 0]);
		expect(radialOffset('right', 2)).toEqual([-2, 0]);
		expect(radialOffset('top', 2)).toEqual([0, 2 - B]);
		expect(radialOffset('bottom', 2)).toEqual([0, -2 + B]);
		expect(radialOffset('center', 2)).toEqual([0, 0]);
		const [x, y] = radialOffset('top-left', 2);
		expect(x).toBeCloseTo(Math.SQRT2, 12);
		expect(y).toBeCloseTo(Math.SQRT2 - B, 12);
	});

	test('ignores a negative radius', () => {
		expect(radialOffset('left', -3)).toEqual([0, 0]);
	});
});

describe('anchorOffsets', () => {
	const base = { variableAnchorOffset: undefined, radialOffset: undefined, textOffset: [0, 0] } as {
		variableAnchorOffset: unknown;
		radialOffset: number | undefined;
		textOffset: [number, number];
	};

	test('has nothing to try without variable anchors', () => {
		expect(anchorOffsets({ ...base, variableAnchor: undefined })).toBeUndefined();
		expect(anchorOffsets({ ...base, variableAnchor: [] })).toBeUndefined();
	});

	test('tries the anchors in order, with the radial offset if the style sets one', () => {
		expect(anchorOffsets({ ...base, variableAnchor: ['left', 'top'], radialOffset: 1 })).toEqual([
			{ anchor: 'left', offset: [1, 0] },
			{ anchor: 'top', offset: [0, 1 - B] },
		]);
	});

	test('else with text-offset, pointing away from each anchor', () => {
		expect(
			anchorOffsets({ ...base, variableAnchor: ['right', 'bottom-left'], textOffset: [-1, 2] }),
		).toEqual([
			{ anchor: 'right', offset: [-1, 0] },
			{ anchor: 'bottom-left', offset: [1, -2 + B] },
		]);
	});

	test('takes text-variable-anchor-offset as it is, shifted to the baseline', () => {
		expect(
			anchorOffsets({
				...base,
				variableAnchor: ['center'],
				variableAnchorOffset: { values: ['top', [0, 1], 'left', [2, 0]] },
			}),
		).toEqual([
			{ anchor: 'top', offset: [0, 1 - B] },
			{ anchor: 'left', offset: [2, 0] },
		]);
	});
});
