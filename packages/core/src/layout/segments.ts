export type Segment = [number, number][];

interface XY {
	x: number;
	y: number;
}

/**
 * Compute a parallel curve offset perpendicular to a polyline's direction.
 *
 * Operates in screen-pixel space (i.e. on the raw geometry, before `roundXY`).
 * A positive offset shifts the line to the **right** of its direction of travel,
 * matching MapLibre's `line-offset` convention. In this renderer's screen space
 * (x right, y down) the right-hand normal of a segment `(dx, dy)` is
 * `(-dy, dx) / len` — for an eastbound segment that is `(0, +1)`, i.e. downward
 * (south), which is the right-hand side. Verified against MapLibre's raster
 * output in the e2e comparison.
 *
 * Note: the GeoJSON loader rewinds polygon rings (outer ring → clockwise) before
 * emitting them as line features, so offsetting a *polygon outline* may land on
 * the opposite side. This function targets genuine line geometry (the `line-offset`
 * use case); polygon-outline offset is out of scope.
 *
 * Interior vertices are placed at the miter intersection of the two adjacent
 * offset edges. The miter is capped at ~4× the offset (|cosHalf| >= 0.25) to
 * avoid spikes at sharp corners. The ends are treated as open; for a closed ring,
 * use {@link strokeLines}.
 *
 * @param points  Screen-space points of the original polyline.
 * @param offset  Perpendicular offset in pixels (positive = right of travel).
 * @returns  A new array of offset points, same length as the input.
 */
export function offsetSegmentPoints(points: XY[], offset: number): XY[] {
	if (offset === 0 || points.length < 2) return points;

	// Right-hand unit normal for each segment.
	const normals: XY[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const dx = points[i + 1]!.x - points[i]!.x;
		const dy = points[i + 1]!.y - points[i]!.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len < 1e-10) {
			// Zero-length segment: reuse the previous normal, or a zero vector.
			normals.push(normals.length > 0 ? normals[normals.length - 1]! : { x: 0, y: 0 });
		} else {
			normals.push({ x: -dy / len, y: dx / len });
		}
	}

	const result: XY[] = [];

	// First point: offset by the first segment's normal.
	result.push({
		x: points[0]!.x + offset * normals[0]!.x,
		y: points[0]!.y + offset * normals[0]!.y,
	});

	// Interior points: miter join between adjacent segment normals.
	for (let i = 1; i < points.length - 1; i++) {
		const n0 = normals[i - 1]!;
		const n1 = normals[i]!;

		const bx = n0.x + n1.x;
		const by = n0.y + n1.y;
		const bLen = Math.sqrt(bx * bx + by * by);

		if (bLen < 1e-10) {
			// Normals cancel (~180° reversal): fall back to a single normal.
			result.push({
				x: points[i]!.x + offset * n0.x,
				y: points[i]!.y + offset * n0.y,
			});
		} else {
			const ux = bx / bLen;
			const uy = by / bLen;
			const cosHalf = n0.x * ux + n0.y * uy;
			// Cap the miter length at ~4× the offset to prevent spikes.
			const clampedCos = Math.abs(cosHalf) < 0.25 ? Math.sign(cosHalf) * 0.25 : cosHalf;
			const scale = offset / clampedCos;
			result.push({
				x: points[i]!.x + scale * ux,
				y: points[i]!.y + scale * uy,
			});
		}
	}

	// Last point: offset by the last segment's normal.
	const last = points.length - 1;
	const lastN = normals[normals.length - 1]!;
	result.push({
		x: points[last]!.x + offset * lastN.x,
		y: points[last]!.y + offset * lastN.y,
	});

	return result;
}

/**
 * The lines of a feature as a line layer strokes them, offset by `offset`: the open ones,
 * and the closed ones. As in MapLibre, only a polygon's rings are closed (a ring that ends
 * where it starts is joined there like at every other vertex); a line that happens to end
 * at its start keeps its caps. A closed ring is returned without its repeated last point.
 */
export function strokeLines(
	lines: XY[][],
	isPolygon: boolean,
	offset: number,
): { open: XY[][]; closed: XY[][] } {
	const open: XY[][] = [];
	const closed: XY[][] = [];
	for (const line of lines) {
		const first = line[0];
		const last = line[line.length - 1];
		if (isPolygon && line.length >= 4 && first!.x === last!.x && first!.y === last!.y) {
			const ring = line.slice(0, -1);
			if (offset === 0) {
				closed.push(ring);
			} else {
				// Offset with the ring's neighbours on both ends, so its first vertex gets a
				// miter like the others.
				const n = ring.length;
				const wrapped = [ring[n - 1]!, ...ring, ring[0]!];
				closed.push(offsetSegmentPoints(wrapped, offset).slice(1, n + 1));
			}
		} else {
			open.push(offset === 0 ? line : offsetSegmentPoints(line, offset));
		}
	}
	return { open, closed };
}

export function chainSegments(segments: Segment[]): Segment[] {
	// Phase 1: normalize segments left-to-right, then chain
	normalizeSegments(segments, 0);
	let chains = greedyChain(segments);

	// Phase 2: normalize remaining chains top-to-bottom, then chain again
	normalizeSegments(chains, 1);
	chains = greedyChain(chains);

	return chains;
}

function normalizeSegments(segments: Segment[], coordIndex: number): void {
	for (const seg of segments) {
		const first = seg[0];
		const last = seg[seg.length - 1];
		if (first && last && last[coordIndex]! < first[coordIndex]!) seg.reverse();
	}
}

function greedyChain(segments: Segment[]): Segment[] {
	const byStart = new Map<string, Segment[]>();
	for (const seg of segments) {
		const start = seg[0];
		if (!start) continue;
		const key = String(start[0]) + ',' + String(start[1]);
		let list = byStart.get(key);
		if (!list) {
			list = [];
			byStart.set(key, list);
		}
		list.push(seg);
	}

	const visited = new Set<Segment>();
	const chains: Segment[] = [];
	for (const seg of segments) {
		if (visited.has(seg)) continue;
		visited.add(seg);
		const chain: Segment = [...seg];
		let endPoint = chain[chain.length - 1];
		let candidates = endPoint
			? byStart.get(String(endPoint[0]) + ',' + String(endPoint[1]))
			: undefined;
		while (candidates) {
			let next: Segment | undefined;
			for (const c of candidates) {
				if (!visited.has(c)) {
					next = c;
					break;
				}
			}
			if (!next) break;
			visited.add(next);
			for (let i = 1; i < next.length; i++) chain.push(next[i]!);
			endPoint = chain[chain.length - 1];
			candidates = endPoint
				? byStart.get(String(endPoint[0]) + ',' + String(endPoint[1]))
				: undefined;
		}
		chains.push(chain);
	}

	return chains;
}
