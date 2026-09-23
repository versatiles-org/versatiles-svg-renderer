import { describe, expect, test } from 'vitest';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { circleShape } from './circle.js';
import type { CircleStyle } from './types.js';

function style(overrides: Partial<CircleStyle> = {}): CircleStyle {
	return {
		color: Color.parse('#f00')!,
		opacity: 1,
		radius: 10,
		translate: [0, 0],
		strokeWidth: 0,
		strokeColor: Color.parse('#000')!,
		strokeOpacity: 1,
		...overrides,
	};
}

describe('circleShape', () => {
	test('a circle without stroke is its fill', () => {
		expect(circleShape(style(), 1, 1)).toEqual({ fill: { radius: 10, opacity: 1 } });
	});

	test('an opaque stroke covers the fill up to the middle of its ring: one shape', () => {
		expect(circleShape(style({ strokeWidth: 4, opacity: 0.5 }), 1, 1)).toEqual({
			fill: { radius: 12, opacity: 0.5 },
			stroke: { radius: 12, width: 4, opacity: 1 },
		});
	});

	test('a translucent stroke does not show the fill through it', () => {
		expect(circleShape(style({ strokeWidth: 4, strokeOpacity: 0.5 }), 1, 1)).toEqual({
			fill: { radius: 10, opacity: 1 },
			stroke: { radius: 12, width: 4, opacity: 0.5 },
		});
	});

	test("the opacities of fill and stroke are independent, and include the colors' alpha", () => {
		expect(circleShape(style({ strokeWidth: 2, opacity: 0, strokeOpacity: 0.8 }), 1, 0.5)).toEqual({
			stroke: { radius: 11, width: 2, opacity: 0.4 },
		});
		expect(circleShape(style({ strokeWidth: 2, strokeOpacity: 0 }), 0.5, 1)).toEqual({
			fill: { radius: 10, opacity: 0.5 },
		});
	});

	test('draws nothing when neither is visible', () => {
		expect(circleShape(style({ opacity: 0, strokeWidth: 2, strokeOpacity: 0 }), 1, 1)).toEqual({});
		expect(circleShape(style({ radius: 0 }), 1, 1)).toEqual({});
	});
});
