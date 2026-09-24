/**
 * Lines with a gap (`line-gap-width`), as MapLibre GL JS draws them: one wide line of which
 * only a band on each side is painted, from gap/2 to gap/2 + width from its middle. The
 * bands follow MapLibre's line geometry (`line_bucket.ts`), so joins and caps come out as
 * in MapLibre:
 *
 * - a round join (`line-round-limit` ≤ miter length ≤ 2) rounds the outer side of the turn
 *   and meets in a miter on the inner side;
 * - a sharper round join (a turn of more than 120°) is drawn as two round caps, so each
 *   segment's bands run on to the vertex, crossing there, and curve around it;
 * - a round or square cap joins the two bands around the end of the line.
 *
 * The result is the middle of each band, to be stroked with the line's width and butt caps.
 */
import { Point2D } from '../../geometry.js';
import { offsetSegmentPoints, strokeLines } from '../../layout/index.js';

type Cap = 'butt' | 'round' | 'square';

/** Arcs are drawn in steps of at most this angle, in radians. */
const ARC_STEP = Math.PI / 18;

/** A turn MapLibre joins as two round caps: a miter length above 2, i.e. more than 120°. */
const SHARP_TURN_COS_HALF = 0.5;

interface GapStyle {
	/** Half the gap plus half the line's width: how far the middle of each band is from the line's. */
	shift: number;
	offset: number;
	cap: Cap;
	join: 'bevel' | 'miter' | 'round';
	/** `line-round-limit`: below this miter length, a round join is drawn as a miter. */
	roundLimit: number;
}

/**
 * The bands of lines with a gap: open ones, and closed rings (without a repeated last point).
 * `lines` and `isPolygon` are as in {@link strokeLines}.
 */
export function gapBands(
	lines: Point2D[][],
	isPolygon: boolean,
	style: GapStyle,
): { open: Point2D[][]; closed: Point2D[][] } {
	const result = { open: [] as Point2D[][], closed: [] as Point2D[][] };
	const { open, closed } = strokeLines(lines, isPolygon, style.offset);
	for (const line of open) addPiecesOf(dedupe(line), false, style, result);
	for (const ring of closed) addPiecesOf(dedupe(ring), true, style, result);
	return result;
}

/** How a vertex is joined: as a miter, round on its outer side, or split into two round caps. */
type Join = 'miter' | 'round' | 'split';

function addPiecesOf(
	points: Point2D[],
	closed: boolean,
	style: GapStyle,
	result: { open: Point2D[][]; closed: Point2D[][] },
): void {
	const n = points.length;
	if (n < 2 || (closed && n < 3)) return;
	const joins = points.map((_, i): Join => {
		if (!closed && (i === 0 || i === n - 1)) return 'miter';
		return joinAt(points[(i + n - 1) % n]!, points[i]!, points[(i + 1) % n]!, style);
	});

	if (closed) {
		const first = joins.indexOf('split');
		if (first < 0) {
			// A ring without splits: each band is a ring too.
			const wrapped = [points[n - 1]!, ...points, points[0]!];
			const wrappedJoins = [joins[n - 1]!, ...joins, joins[0]!];
			for (const side of [-1, 1]) {
				result.closed.push(band(wrapped, wrappedJoins, side * style.shift).slice(1, n + 1));
			}
			return;
		}
		// Start at a split, and go round to it again: pieces with round caps at both ends.
		const rotated = [...points.slice(first), ...points.slice(0, first + 1)];
		const rotatedJoins = [...joins.slice(first), ...joins.slice(0, first + 1)];
		addPieces(rotated, rotatedJoins, 'round', 'round', style, result);
		return;
	}
	addPieces(points, joins, style.cap, style.cap, style, result);
}

/** Splits `points` at its split joins, and adds the bands of each piece. */
function addPieces(
	points: Point2D[],
	joins: Join[],
	startCap: Cap,
	endCap: Cap,
	style: GapStyle,
	result: { open: Point2D[][]; closed: Point2D[][] },
): void {
	let start = 0;
	for (let i = 1; i < points.length; i++) {
		if (i < points.length - 1 && joins[i] !== 'split') continue;
		addPiece(
			points.slice(start, i + 1),
			joins.slice(start, i + 1),
			start === 0 ? startCap : 'round',
			i === points.length - 1 ? endCap : 'round',
			style,
			result,
		);
		start = i;
	}
}

/** The two bands of one piece of a line, joined around its ends by its caps. */
function addPiece(
	points: Point2D[],
	joins: Join[],
	startCap: Cap,
	endCap: Cap,
	style: GapStyle,
	result: { open: Point2D[][]; closed: Point2D[][] },
): void {
	const { shift } = style;
	const left = band(points, joins, -shift);
	const right = band(points, joins, shift);
	const last = points.length - 1;
	// Around the end: from the left band to the right one; around the start: back again.
	const endCapPoints = capPoints(
		points[last]!,
		direction(points[last - 1]!, points[last]!),
		endCap,
		shift,
	);
	const startCapPoints = capPoints(points[0]!, direction(points[1]!, points[0]!), startCap, shift);

	if (startCap === 'butt' && endCap === 'butt') {
		result.open.push(left, right);
	} else if (startCap === 'butt') {
		result.open.push([...left, ...endCapPoints, ...right.reverse()]);
	} else if (endCap === 'butt') {
		result.open.push([...right.reverse(), ...startCapPoints, ...left]);
	} else {
		result.closed.push([...left, ...endCapPoints, ...right.reverse(), ...startCapPoints]);
	}
}

/**
 * The points a cap adds between the bands, around `end` of a line heading in `dir` there:
 * from the band on the left of the heading to the one on its right.
 */
function capPoints(end: Point2D, dir: Point2D, cap: Cap, shift: number): Point2D[] {
	// The right-hand normal of the heading, as in `offsetSegmentPoints`.
	const nx = -dir.y;
	const ny = dir.x;
	if (cap === 'square') {
		// MapLibre's square cap extends the line by half its width: the bands turn there.
		return [
			new Point2D(end.x + shift * (dir.x - nx), end.y + shift * (dir.y - ny)),
			new Point2D(end.x + shift * (dir.x + nx), end.y + shift * (dir.y + ny)),
		];
	}
	if (cap === 'butt') return [];
	const points: Point2D[] = [];
	const steps = Math.ceil(Math.PI / ARC_STEP);
	for (let k = 1; k < steps; k++) {
		const t = (k / steps) * Math.PI;
		const across = -Math.cos(t);
		const along = Math.sin(t);
		points.push(
			new Point2D(
				end.x + shift * (across * nx + along * dir.x),
				end.y + shift * (across * ny + along * dir.y),
			),
		);
	}
	return points;
}

/** The band of `points` at `shift` pixels to the right of it, rounded where `joins` say. */
function band(points: Point2D[], joins: Join[], shift: number): Point2D[] {
	const mitered = offsetSegmentPoints(points, shift);
	const result: Point2D[] = [];
	for (let i = 0; i < points.length; i++) {
		const miter = mitered[i]!;
		if (i === 0 || i === points.length - 1 || joins[i] !== 'round') {
			result.push(new Point2D(miter.x, miter.y));
			continue;
		}
		const p = points[i]!;
		const d0 = direction(points[i - 1]!, p);
		const d1 = direction(p, points[i + 1]!);
		// The outer side of the turn is the one the next segment turns away from.
		const outer = shift * (-d0.y * d1.x + d0.x * d1.y) < 0;
		if (!outer) {
			result.push(new Point2D(miter.x, miter.y));
			continue;
		}
		const a0 = Math.atan2(shift * d0.x, -shift * d0.y);
		let delta = Math.atan2(shift * d1.x, -shift * d1.y) - a0;
		delta = Math.atan2(Math.sin(delta), Math.cos(delta));
		const steps = Math.max(1, Math.ceil(Math.abs(delta) / ARC_STEP));
		const radius = Math.abs(shift);
		for (let k = 0; k <= steps; k++) {
			const a = a0 + (delta * k) / steps;
			result.push(new Point2D(p.x + radius * Math.cos(a), p.y + radius * Math.sin(a)));
		}
	}
	return result;
}

/** How MapLibre joins the segments at `b`, from `a` and on to `c`. */
function joinAt(a: Point2D, b: Point2D, c: Point2D, style: GapStyle): Join {
	if (style.join !== 'round') return 'miter';
	const d0 = direction(a, b);
	const d1 = direction(b, c);
	// The cosine of half the turn; the miter length is its inverse.
	const cosHalf = Math.sqrt(Math.max(0, (1 + d0.x * d1.x + d0.y * d1.y) / 2));
	if (cosHalf < SHARP_TURN_COS_HALF) return 'split';
	return 1 / cosHalf < style.roundLimit ? 'miter' : 'round';
}

function direction(from: Point2D, to: Point2D): Point2D {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	return new Point2D((to.x - from.x) / length, (to.y - from.y) / length);
}

/** `points` without repeated ones, as `Point2D`s. */
function dedupe(points: { x: number; y: number }[]): Point2D[] {
	return points
		.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y)
		.map((p) => new Point2D(p.x, p.y));
}
