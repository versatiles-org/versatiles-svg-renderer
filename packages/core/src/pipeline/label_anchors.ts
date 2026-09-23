/**
 * Where a symbol (label or icon) of a feature is placed. For `symbol-placement: "point"`
 * as MapLibre GL JS does (`symbol_layout.ts`): a point at each point, the first vertex of
 * each line, and the pole of inaccessibility of each polygon — the point inside it that is
 * farthest from its edges.
 *
 * Labels along lines (`"line"`, `"line-center"`) are not supported: such a feature gets a
 * single, straight label in the middle of its longest line, as `"line-center"` would place
 * it, and only if that line is at least as long as the label, as MapLibre requires. One per
 * feature, not per line: a street is made of many short lines.
 */
import { Point2D, type Feature } from '../geometry.js';

/** How close to the true pole of inaccessibility the search has to get, in pixels. */
const PRECISION = 1;

/**
 * The points of `feature` its symbols are placed at, in screen coordinates. `labelLength`
 * is the length of the label (text or icon) along a line, in pixels.
 */
export function labelAnchors(feature: Feature, placement = 'point', labelLength = 0): Point2D[] {
	if (placement !== 'point' && feature.type !== 'Point') {
		// A polygon along a line is placed on its outline, like a line.
		const longest = longestLine(feature.geometry);
		if (!longest) return [];
		const length = lineLength(longest);
		return length >= labelLength ? [pointAlong(longest, length / 2)] : [];
	}
	switch (feature.type) {
		case 'Point':
			return feature.geometry.flat();
		case 'LineString':
			// Deliberately the first vertex, not the middle: mapbox/mapbox-gl-js#3808.
			return feature.geometry.flatMap((line) => (line.length > 0 ? [line[0]!] : []));
		case 'Polygon':
			return classifyRings(feature.geometry).map((polygon) =>
				poleOfInaccessibility(polygon, PRECISION),
			);
	}
}

function lineLength(line: Point2D[]): number {
	let length = 0;
	for (let i = 1; i < line.length; i++) {
		length += Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
	}
	return length;
}

function longestLine(lines: Point2D[][]): Point2D[] | undefined {
	let longest: Point2D[] | undefined;
	let longestLength = -1;
	for (const line of lines) {
		if (line.length === 0) continue;
		const length = lineLength(line);
		if (length > longestLength) {
			longest = line;
			longestLength = length;
		}
	}
	return longest;
}

/** The point at `distance` along `line`, measured from its start. */
function pointAlong(line: Point2D[], distance: number): Point2D {
	for (let i = 1; i < line.length; i++) {
		const a = line[i - 1]!;
		const b = line[i]!;
		const segment = Math.hypot(b.x - a.x, b.y - a.y);
		if (segment > 0 && distance <= segment) {
			const t = distance / segment;
			return new Point2D(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
		}
		distance -= segment;
	}
	return line[line.length - 1]!;
}

/**
 * Groups the rings of a (multi-)polygon into polygons: an outer ring, followed by its
 * holes. Outer rings are those wound like the first ring (MapLibre's `classifyRings`), so
 * either winding convention works. Rings without area are left out.
 */
export function classifyRings(rings: Point2D[][]): Point2D[][][] {
	const polygons: Point2D[][][] = [];
	let polygon: Point2D[][] | undefined;
	let outerIsNegative: boolean | undefined;
	for (const ring of rings) {
		const area = signedArea(ring);
		if (area === 0) continue;
		outerIsNegative ??= area < 0;
		if (outerIsNegative === area < 0) {
			if (polygon) polygons.push(polygon);
			polygon = [ring];
		} else {
			polygon?.push(ring);
		}
	}
	if (polygon) polygons.push(polygon);
	return polygons;
}

function signedArea(ring: Point2D[]): number {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i]!;
		const b = ring[j]!;
		sum += (b.x - a.x) * (a.y + b.y);
	}
	return sum;
}

/** A square of the search: its center, half its size, and how far its center is inside. */
interface Cell {
	x: number;
	y: number;
	h: number;
	/** Distance of the center to the polygon's edges; negative outside of it. */
	d: number;
	/** The largest distance any point of the cell can have. */
	max: number;
}

function makeCell(x: number, y: number, h: number, polygon: Point2D[][]): Cell {
	const d = pointToPolygonDistance(x, y, polygon);
	return { x, y, h, d, max: d + h * Math.SQRT2 };
}

/**
 * The point inside `polygon` (an outer ring and its holes) farthest from its edges, to
 * within `precision` (MapLibre's `findPoleOfInaccessibility`, after mapbox/polylabel).
 */
export function poleOfInaccessibility(polygon: Point2D[][], precision: number): Point2D {
	const outer = polygon[0]!;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of outer) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	const cellSize = Math.min(maxX - minX, maxY - minY);
	if (!(cellSize > 0)) return new Point2D(minX, minY);

	// Cover the polygon with square cells, then refine the most promising cells first.
	const queue = new MaxHeap();
	let h = cellSize / 2;
	for (let x = minX; x < maxX; x += cellSize) {
		for (let y = minY; y < maxY; y += cellSize) queue.push(makeCell(x + h, y + h, h, polygon));
	}

	let best = centroidCell(polygon);
	for (let cell = queue.pop(); cell; cell = queue.pop()) {
		if (cell.d > best.d || !best.d) best = cell;
		if (cell.max - best.d <= precision) continue;
		h = cell.h / 2;
		queue.push(makeCell(cell.x - h, cell.y - h, h, polygon));
		queue.push(makeCell(cell.x + h, cell.y - h, h, polygon));
		queue.push(makeCell(cell.x - h, cell.y + h, h, polygon));
		queue.push(makeCell(cell.x + h, cell.y + h, h, polygon));
	}
	return new Point2D(best.x, best.y);
}

/** The centroid of the outer ring, as the first guess. */
function centroidCell(polygon: Point2D[][]): Cell {
	const ring = polygon[0]!;
	let area = 0;
	let x = 0;
	let y = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i]!;
		const b = ring[j]!;
		const f = a.x * b.y - b.x * a.y;
		x += (a.x + b.x) * f;
		y += (a.y + b.y) * f;
		area += f * 3;
	}
	if (area === 0) return makeCell(ring[0]!.x, ring[0]!.y, 0, polygon);
	return makeCell(x / area, y / area, 0, polygon);
}

/** Signed distance from a point to the polygon's edges: positive inside, negative outside. */
function pointToPolygonDistance(x: number, y: number, polygon: Point2D[][]): number {
	let inside = false;
	let minDistSq = Infinity;
	for (const ring of polygon) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const a = ring[i]!;
			const b = ring[j]!;
			if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
				inside = !inside;
			}
			minDistSq = Math.min(minDistSq, segmentDistanceSquared(x, y, a, b));
		}
	}
	return (inside ? 1 : -1) * Math.sqrt(minDistSq);
}

function segmentDistanceSquared(px: number, py: number, a: Point2D, b: Point2D): number {
	let x = a.x;
	let y = a.y;
	let dx = b.x - x;
	let dy = b.y - y;
	if (dx !== 0 || dy !== 0) {
		const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
		if (t > 1) {
			x = b.x;
			y = b.y;
		} else if (t > 0) {
			x += dx * t;
			y += dy * t;
		}
	}
	dx = px - x;
	dy = py - y;
	return dx * dx + dy * dy;
}

/** A binary heap of cells, largest `max` first. */
class MaxHeap {
	readonly #items: Cell[] = [];

	push(cell: Cell): void {
		const items = this.#items;
		let i = items.push(cell) - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (items[parent]!.max >= cell.max) break;
			items[i] = items[parent]!;
			i = parent;
		}
		items[i] = cell;
	}

	pop(): Cell | undefined {
		const items = this.#items;
		const top = items[0];
		const last = items.pop();
		if (items.length === 0 || !last) return top;
		let i = 0;
		for (;;) {
			const left = 2 * i + 1;
			if (left >= items.length) break;
			const right = left + 1;
			const child = right < items.length && items[right]!.max > items[left]!.max ? right : left;
			if (items[child]!.max <= last.max) break;
			items[i] = items[child]!;
			i = child;
		}
		items[i] = last;
		return top;
	}
}
