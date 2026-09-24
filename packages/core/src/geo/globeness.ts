/**
 * How "globe-like" a style's `projection` is at a zoom level: the value of its expression,
 * as MapLibre GL JS evaluates it.
 */
import type { ProjectionSpecification } from '@maplibre/maplibre-gl-style-spec';

/** What MapLibre expands `projection: { type: 'globe' }` into (`projection_factory.ts`). */
const GLOBE_PRESET = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	'vertical-perspective',
	12,
	'mercator',
];

/**
 * Returns how "globe-like" the projection is at the given zoom, matching MapLibre's
 * `GlobeProjection.transitionState`: 0 = mercator, 1 = globe, in between = transition.
 */
export function getGlobeness(
	projection: ProjectionSpecification | undefined,
	zoom: number,
): number {
	return evaluateGlobeness(projection?.type ?? 'mercator', zoom);
}

function evaluateGlobeness(value: unknown, zoom: number): number {
	if (typeof value === 'string') {
		switch (value) {
			case 'globe':
				return evaluateGlobeness(GLOBE_PRESET, zoom);
			case 'vertical-perspective':
				return 1;
			default:
				return 0;
		}
	}
	if (!Array.isArray(value)) return 0;

	const [op, ...args] = value as unknown[];
	if (op === 'literal') return evaluateGlobeness(args[0], zoom);
	if (op === 'step') {
		// ["step", ["zoom"], output0, stop1, output1, ...]
		let result = args[1];
		for (let i = 2; i + 1 < args.length; i += 2) {
			if (zoom >= (args[i] as number)) result = args[i + 1];
		}
		return evaluateGlobeness(result, zoom);
	}
	if (op === 'interpolate') {
		// ["interpolate", ["linear"] | ["exponential", base], ["zoom"], stop0, output0, ...]
		const interpolation = args[0] as unknown[];
		const base = interpolation[0] === 'exponential' ? (interpolation[1] as number) : 1;
		const stops: [number, unknown][] = [];
		for (let i = 2; i + 1 < args.length; i += 2) stops.push([args[i] as number, args[i + 1]]);
		if (stops.length === 0) return 0;
		if (zoom <= stops[0]![0]) return evaluateGlobeness(stops[0]![1], zoom);
		for (let i = 1; i < stops.length; i++) {
			const [z1, out1] = stops[i]!;
			if (zoom > z1) continue;
			const [z0, out0] = stops[i - 1]!;
			const t = interpolationFactor(zoom, z0, z1, base);
			const g0 = evaluateGlobeness(out0, zoom);
			const g1 = evaluateGlobeness(out1, zoom);
			return g0 + (g1 - g0) * t;
		}
		return evaluateGlobeness(stops[stops.length - 1]![1], zoom);
	}
	// A projection transition literal: [from, to, transition]
	if (value.length === 3 && typeof value[2] === 'number') {
		const g0 = evaluateGlobeness(value[0], zoom);
		const g1 = evaluateGlobeness(value[1], zoom);
		return g0 + (g1 - g0) * value[2];
	}
	return 0;
}

function interpolationFactor(input: number, lower: number, upper: number, base: number): number {
	const difference = upper - lower;
	if (difference === 0) return 0;
	const progress = input - lower;
	if (base === 1) return progress / difference;
	return (Math.pow(base, progress) - 1) / (Math.pow(base, difference) - 1);
}
