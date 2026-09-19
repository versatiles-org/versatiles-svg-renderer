/**
 * Clipping of vector tile geometry to the tile's own square.
 *
 * Vector tiles contain a buffer: geometry reaches a little beyond the tile, so a polygon on
 * a tile border exists in both tiles. MapLibre draws each tile clipped to its square (with the
 * stencil buffer), so nothing is drawn twice. Opaque fills hide the difference, translucent
 * ones do not: the overlap would be drawn with double opacity.
 */

export interface XY {
	x: number;
	y: number;
}

/** Whether any point lies outside of the square [min, max]². */
export function exceedsSquare(rings: XY[][], min: number, max: number): boolean {
	return rings.some((ring) => ring.some(({ x, y }) => x < min || x > max || y < min || y > max));
}

/**
 * Clips the rings of a polygon to the square [min, max]² (Sutherland–Hodgman). Rings that
 * vanish are dropped.
 */
export function clipPolygon(rings: XY[][], min: number, max: number): XY[][] {
	const result: XY[][] = [];
	for (const ring of rings) {
		let points = ring;
		points = clipAgainst(
			points,
			(p) => p.x >= min,
			(a, b) => lerpAtX(a, b, min),
		);
		points = clipAgainst(
			points,
			(p) => p.x <= max,
			(a, b) => lerpAtX(a, b, max),
		);
		points = clipAgainst(
			points,
			(p) => p.y >= min,
			(a, b) => lerpAtY(a, b, min),
		);
		points = clipAgainst(
			points,
			(p) => p.y <= max,
			(a, b) => lerpAtY(a, b, max),
		);
		if (points.length >= 3) result.push(points);
	}
	return result;
}

/**
 * The boundary of a polygon within the square [min, max]², as open polylines: the parts of
 * its rings inside the square, without the edges the clipping adds along the square's border.
 * (MapLibre's fill outline follows the original rings, cut off at the tile border.)
 */
export function clipPolygonOutline(rings: XY[][], min: number, max: number): XY[][] {
	const result: XY[][] = [];
	for (const ring of rings) {
		if (ring.length < 2) continue;
		const first = ring[0]!;
		const last = ring[ring.length - 1]!;
		const closed = first.x === last.x && first.y === last.y ? ring : [...ring, first];
		result.push(...clipLine(closed, min, max));
	}
	return result;
}

/** Clips a polyline to the square [min, max]², returning the parts inside of it. */
export function clipLine(line: XY[], min: number, max: number): XY[][] {
	const parts: XY[][] = [];
	let current: XY[] = [];
	for (let i = 0; i + 1 < line.length; i++) {
		const segment = clipSegment(line[i]!, line[i + 1]!, min, max);
		if (!segment) {
			if (current.length > 1) parts.push(current);
			current = [];
			continue;
		}
		const [a, b] = segment;
		const last = current[current.length - 1];
		if (last?.x !== a.x || last.y !== a.y) {
			if (current.length > 1) parts.push(current);
			current = [a];
		}
		current.push(b);
		// The segment left the square: the line continues elsewhere.
		if (b !== line[i + 1]) {
			parts.push(current);
			current = [];
		}
	}
	if (current.length > 1) parts.push(current);
	return parts;
}

/** Liang–Barsky: the part of the segment a→b inside the square, or undefined. */
function clipSegment(a: XY, b: XY, min: number, max: number): [XY, XY] | undefined {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	let t0 = 0;
	let t1 = 1;
	for (const [p, q] of [
		[-dx, a.x - min],
		[dx, max - a.x],
		[-dy, a.y - min],
		[dy, max - a.y],
	] as const) {
		if (p === 0) {
			if (q < 0) return undefined;
			continue;
		}
		const t = q / p;
		if (p < 0) {
			if (t > t1) return undefined;
			if (t > t0) t0 = t;
		} else {
			if (t < t0) return undefined;
			if (t < t1) t1 = t;
		}
	}
	return [
		t0 === 0 ? a : { x: a.x + dx * t0, y: a.y + dy * t0 },
		t1 === 1 ? b : { x: a.x + dx * t1, y: a.y + dy * t1 },
	];
}

function clipAgainst(
	points: XY[],
	inside: (p: XY) => boolean,
	intersect: (a: XY, b: XY) => XY,
): XY[] {
	const result: XY[] = [];
	for (let i = 0; i < points.length; i++) {
		const current = points[i]!;
		const previous = points[(i + points.length - 1) % points.length]!;
		const currentInside = inside(current);
		if (currentInside !== inside(previous)) result.push(intersect(previous, current));
		if (currentInside) result.push(current);
	}
	return result;
}

function lerpAtX(a: XY, b: XY, x: number): XY {
	return { x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) };
}

function lerpAtY(a: XY, b: XY, y: number): XY {
	return { x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y };
}
