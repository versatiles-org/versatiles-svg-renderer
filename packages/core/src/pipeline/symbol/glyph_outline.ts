/**
 * The outlines of glyphs, traced from their signed distance fields (SDF): where the field
 * crosses MapLibre GL JS's edge value, the glyph's shape as MapLibre draws it. The outline
 * is placed in MapLibre's glyph frame, so a renderer only has to move, turn and scale it.
 */
import type { GlyphOutline } from '../../types.js';
import { type Glyph, GLYPH_BORDER, GLYPH_EM } from '../../sources/index.js';

/** The SDF value of the glyph's edge: MapLibre's shader draws the glyph above 0.75. */
const EDGE = 0.75 * 255;

/** How far a simplified outline may stray from the traced one, in pixels at 24 px per em. */
const TOLERANCE = 0.08;

/** MapLibre's `SHAPING_DEFAULT_OFFSET`: from the middle of a line of text to its glyphs. */
const LINE_OFFSET = -17;

/** Traces `glyph`'s outline; `key` identifies it (e.g. font stack and code point). */
export function traceGlyph(glyph: Glyph, key: string): GlyphOutline {
	const advance = glyph.advance / GLYPH_EM;
	const w = glyph.width + 2 * GLYPH_BORDER;
	const h = glyph.height + 2 * GLYPH_BORDER;
	if (glyph.width === 0 || glyph.height === 0 || glyph.bitmap.length < w * h) {
		return { key, rings: [], advance };
	}
	const dx = glyph.left - GLYPH_BORDER - glyph.advance / 2;
	const dy = LINE_OFFSET - glyph.top - GLYPH_BORDER;
	const rings = traceContours(glyph.bitmap, w, h).map((ring) =>
		simplify(ring, TOLERANCE).map(([x, y]): [number, number] => [
			Math.round((x + dx) * 100) / 100,
			Math.round((y + dy) * 100) / 100,
		]),
	);
	return { key, rings: rings.filter((ring) => ring.length >= 3), advance };
}

/**
 * The closed contours where the field `values` (`w` × `h`, row by row, sampled at pixel
 * centers) crosses {@link EDGE}, by marching squares. Outside the bitmap, the field is 0,
 * so every contour closes.
 */
export function traceContours(values: Uint8Array, w: number, h: number): [number, number][][] {
	const at = (i: number, j: number): number =>
		i < 0 || j < 0 || i >= w || j >= h ? 0 : values[j * w + i]!;

	// Where the contour crosses an edge between two samples, by the edge's identity.
	const points = new Map<string, [number, number]>();
	const crossing = (key: string, i0: number, j0: number, i1: number, j1: number): string => {
		if (!points.has(key)) {
			const v0 = at(i0, j0);
			const v1 = at(i1, j1);
			const t = v1 === v0 ? 0.5 : (EDGE - v0) / (v1 - v0);
			points.set(key, [i0 + 0.5 + (i1 - i0) * t, j0 + 0.5 + (j1 - j0) * t]);
		}
		return key;
	};
	const neighbours = new Map<string, string[]>();
	const link = (a: string, b: string): void => {
		(neighbours.get(a) ?? neighbours.set(a, []).get(a)!).push(b);
		(neighbours.get(b) ?? neighbours.set(b, []).get(b)!).push(a);
	};

	for (let j = -1; j < h; j++) {
		for (let i = -1; i < w; i++) {
			const tl = at(i, j) > EDGE;
			const tr = at(i + 1, j) > EDGE;
			const br = at(i + 1, j + 1) > EDGE;
			const bl = at(i, j + 1) > EDGE;
			const cell = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
			if (cell === 0 || cell === 15) continue;
			const top = (): string => crossing(`h${String(i)},${String(j)}`, i, j, i + 1, j);
			const bottom = (): string =>
				crossing(`h${String(i)},${String(j + 1)}`, i, j + 1, i + 1, j + 1);
			const left = (): string => crossing(`v${String(i)},${String(j)}`, i, j, i, j + 1);
			const right = (): string =>
				crossing(`v${String(i + 1)},${String(j)}`, i + 1, j, i + 1, j + 1);
			const centerInside = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > EDGE;
			switch (cell) {
				case 1:
				case 14:
					link(left(), bottom());
					break;
				case 2:
				case 13:
					link(bottom(), right());
					break;
				case 3:
				case 12:
					link(left(), right());
					break;
				case 4:
				case 11:
					link(top(), right());
					break;
				case 6:
				case 9:
					link(top(), bottom());
					break;
				case 7:
				case 8:
					link(top(), left());
					break;
				case 5: // top right and bottom left inside: a saddle
					if (centerInside) {
						link(top(), left());
						link(bottom(), right());
					} else {
						link(left(), bottom());
						link(top(), right());
					}
					break;
				case 10: // top left and bottom right inside: a saddle
					if (centerInside) {
						link(top(), right());
						link(left(), bottom());
					} else {
						link(top(), left());
						link(bottom(), right());
					}
					break;
			}
		}
	}

	// Every crossing has two neighbours: walk each cycle once.
	const rings: [number, number][][] = [];
	const visited = new Set<string>();
	for (const start of neighbours.keys()) {
		if (visited.has(start)) continue;
		const ring: [number, number][] = [];
		let previous: string | undefined;
		let current: string | undefined = start;
		while (current !== undefined && !visited.has(current)) {
			visited.add(current);
			ring.push(points.get(current)!);
			const next: string | undefined = neighbours
				.get(current)!
				.find((candidate) => candidate !== previous && !visited.has(candidate));
			previous = current;
			current = next;
		}
		if (ring.length >= 3) rings.push(ring);
	}
	return rings;
}

/** A closed ring with points dropped where they stray less than `tolerance` (Douglas–Peucker). */
function simplify(ring: [number, number][], tolerance: number): [number, number][] {
	if (ring.length <= 4) return ring;
	// Split the ring at its first point and the point farthest from it, and simplify both halves.
	const [x0, y0] = ring[0]!;
	let far = 1;
	let farDistance = -1;
	ring.forEach(([x, y], i) => {
		const d = (x - x0) ** 2 + (y - y0) ** 2;
		if (d > farDistance) {
			farDistance = d;
			far = i;
		}
	});
	const first = simplifyLine(ring.slice(0, far + 1), tolerance);
	const second = simplifyLine([...ring.slice(far), ring[0]!], tolerance);
	return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function simplifyLine(line: [number, number][], tolerance: number): [number, number][] {
	if (line.length <= 2) return line;
	const [ax, ay] = line[0]!;
	const [bx, by] = line[line.length - 1]!;
	const length = Math.hypot(bx - ax, by - ay);
	let index = 0;
	let max = 0;
	for (let i = 1; i < line.length - 1; i++) {
		const [px, py] = line[i]!;
		const d =
			length > 0
				? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
				: Math.hypot(px - ax, py - ay);
		if (d > max) {
			max = d;
			index = i;
		}
	}
	if (max <= tolerance) return [line[0]!, line[line.length - 1]!];
	return [
		...simplifyLine(line.slice(0, index + 1), tolerance).slice(0, -1),
		...simplifyLine(line.slice(index), tolerance),
	];
}
