/**
 * The shape of a circle, shared by every backend so the two cannot drift apart.
 */
import type { CircleStyle } from './types.js';

/**
 * How to draw one circle as MapLibre does: the fill up to `radius`, the stroke over the
 * ring from `radius` to `radius + strokeWidth`, each with its own opacity. Canvas and SVG
 * strokes are centered on their path, so the stroke is drawn at the middle of the ring. An
 * opaque stroke covers the fill, which then reaches to that middle too, so both are one
 * shape without a seam; a translucent one must not show the fill through it, so the fill
 * ends at `radius`.
 */
export interface CircleShape {
	/** Radius and opacity of the fill, if it is visible. */
	fill?: { radius: number; opacity: number };
	/** Radius (the middle of the ring), width and opacity of the stroke, if it is visible. */
	stroke?: { radius: number; width: number; opacity: number };
}

export function circleShape(
	style: CircleStyle,
	fillAlpha: number,
	strokeAlpha: number,
): CircleShape {
	const fillOpacity = style.opacity * fillAlpha;
	const strokeOpacity = style.strokeOpacity * strokeAlpha;
	const hasStroke = style.strokeWidth > 0 && strokeOpacity > 0;
	const shape: CircleShape = {};
	if (hasStroke) {
		const radius = style.radius + style.strokeWidth / 2;
		shape.stroke = { radius, width: style.strokeWidth, opacity: strokeOpacity };
		if (style.radius > 0 && fillOpacity > 0) {
			shape.fill = { radius: strokeOpacity >= 1 ? radius : style.radius, opacity: fillOpacity };
		}
	} else if (style.radius > 0 && fillOpacity > 0) {
		shape.fill = { radius: style.radius, opacity: fillOpacity };
	}
	return shape;
}

/** A stop of a {@link circleGradient}: its color and opacity. */
export interface CircleGradientStop {
	/** Where along the radius, from 0 (center) to 1 (outer edge). */
	offset: number;
	rgb: [number, number, number];
	opacity: number;
}

/** How many stops a blurred circle's gradient is sampled with, besides its edges. */
const GRADIENT_SAMPLES = 24;

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/**
 * A blurred circle (`circle-blur`) as MapLibre's circle shader draws it, as one circle of
 * the outer radius filled with a radial gradient: at each distance from the center, the
 * fill's and the stroke's color are mixed (premultiplied), turning from fill to stroke over
 * the `blur` share of the outer radius just inside `radius`, and the whole fades out over
 * the same share just inside the outer edge.
 */
export function circleGradient(
	style: CircleStyle,
	fill: { rgb: [number, number, number]; alpha: number },
	stroke: { rgb: [number, number, number]; alpha: number },
): { radius: number; stops: CircleGradientStop[] } {
	const blur = style.blur ?? 0;
	const outer = style.radius + Math.max(0, style.strokeWidth);
	const border = outer > 0 ? style.radius / outer : 1;
	const hasStroke = style.strokeWidth >= 0.01;
	const fillOpacity = style.opacity * fill.alpha;
	const strokeOpacity = style.strokeOpacity * stroke.alpha;

	const offsets = new Set([0, 1, border, border - blur, 1 - blur]);
	for (let i = 1; i < GRADIENT_SAMPLES; i++) offsets.add(i / GRADIENT_SAMPLES);
	const stops = [...offsets]
		.filter((offset) => offset >= 0 && offset <= 1)
		.sort((a, b) => a - b)
		.map((offset): CircleGradientStop => {
			const fade = smoothstep(0, blur, 1 - offset);
			const toStroke = hasStroke ? smoothstep(-blur, 0, offset - border) : 0;
			const alpha = fillOpacity * (1 - toStroke) + strokeOpacity * toStroke;
			const channel = (i: 0 | 1 | 2): number =>
				alpha > 0
					? (fill.rgb[i] * fillOpacity * (1 - toStroke) +
							stroke.rgb[i] * strokeOpacity * toStroke) /
						alpha
					: fill.rgb[i];
			return { offset, rgb: [channel(0), channel(1), channel(2)], opacity: alpha * fade };
		});
	return { radius: outer, stops };
}
