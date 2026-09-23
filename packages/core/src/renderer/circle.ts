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
