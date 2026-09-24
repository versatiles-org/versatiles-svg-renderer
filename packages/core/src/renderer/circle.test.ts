import { describe, expect, test } from 'vitest';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { circleGradient, circleShape } from './circle.js';
import type { CircleStyle } from '../types.js';

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

describe('circleGradient', () => {
	const orange = { rgb: [255, 170, 0] as [number, number, number], alpha: 1 };
	const cyan = { rgb: [0, 204, 255] as [number, number, number], alpha: 1 };
	const at = (stops: { offset: number; rgb: number[]; opacity: number }[], offset: number) =>
		stops.find((stop) => Math.abs(stop.offset - offset) < 1e-9)!;

	test('fades a blurred circle out over the blur share of its radius', () => {
		const { radius, stops } = circleGradient(style({ blur: 0.5 }), orange, cyan);
		expect(radius).toBe(10);
		expect(at(stops, 0).opacity).toBe(1);
		expect(at(stops, 0.5).opacity).toBe(1);
		expect(at(stops, 0.75).opacity).toBeCloseTo(0.5);
		expect(at(stops, 1).opacity).toBe(0);
		// Without a stroke, the fill's color throughout.
		expect(stops.every((stop) => stop.rgb.join() === '255,170,0')).toBe(true);
	});

	test('turns from the fill into the stroke over the blur share inside the radius', () => {
		// Radius 10, stroke 10: the border lies at half of the outer radius 20.
		const { radius, stops } = circleGradient(
			style({ blur: 0.25, radius: 10, strokeWidth: 10 }),
			orange,
			cyan,
		);
		expect(radius).toBe(20);
		expect(at(stops, 0.25).rgb).toEqual([255, 170, 0]);
		expect(at(stops, 0.5).rgb).toEqual([0, 204, 255]);
		const middle = at(stops, 0.375).rgb;
		expect(middle[0]).toBeCloseTo(127.5);
	});

	test('mixes translucent colors premultiplied, as MapLibre does', () => {
		// A transparent fill turning into an opaque stroke: the color is the stroke's all along.
		const { stops } = circleGradient(
			style({ blur: 0.5, radius: 10, strokeWidth: 10, opacity: 0 }),
			orange,
			cyan,
		);
		const midway = at(stops, 0.375);
		expect(midway.rgb).toEqual([0, 204, 255]);
		expect(midway.opacity).toBeGreaterThan(0);
		expect(midway.opacity).toBeLessThan(1);
	});
});
