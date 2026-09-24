/**
 * Geometry for drawing a line with `line-pattern`, shared by every backend: the sprite image
 * repeated along the line, its height across the line's width, as MapLibre GL JS draws it
 * (`line_pattern.fragment.glsl`).
 *
 * Each segment of the line gets a frame of its own: `s` runs along the line (its distance
 * from the line's start, in pixels) and `t` across it, from 0 on the side the image's top is
 * on to the line's width on the other. The image is repeated along `s`, one copy per
 * `period`, and spans `t` from 0 to the width. Each segment covers a polygon bounded by the
 * bisectors of its joins, so neighbouring segments meet without a gap, and reaching past the
 * line's sides and ends; the backend clips it all to the stroked line, which draws the
 * line's joins and caps.
 */

interface Point {
	x: number;
	y: number;
}

/** An affine transform [a, b, c, d, e, f] from a segment's frame (s, t) to the screen. */
export type Matrix = [number, number, number, number, number, number];

export interface PatternStrip {
	/** From the segment's frame to the screen. */
	matrix: Matrix;
	/** The part of the frame the segment covers: a quadrilateral, in (s, t). */
	polygon: [number, number][];
}

/**
 * The strips of a line of `width` pixels: one per segment of `points`, a ring if `closed`.
 * MapLibre puts the image's top on the side of the line's normal (the direction turned 90°
 * clockwise on screen): on the right, going along the line.
 */
export function linePatternStrips(points: Point[], closed: boolean, width: number): PatternStrip[] {
	const line = points.filter(
		(p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y,
	);
	if (closed && line.length > 1) {
		const first = line[0]!;
		const last = line[line.length - 1]!;
		if (first.x === last.x && first.y === last.y) line.pop();
	}
	if (line.length < 2) return [];

	const count = closed ? line.length : line.length - 1;
	const segments = Array.from({ length: count }, (_, i) => {
		const a = line[i]!;
		const b = line[(i + 1) % line.length]!;
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const dx = (b.x - a.x) / length;
		const dy = (b.y - a.y) / length;
		return { a, b, length, dx, dy, nx: -dy, ny: dx };
	});

	// How far the polygons reach past the line's sides, and past its ends for the caps.
	const reach = width / 2 + 2;
	const capReach = width / 2 + 2;

	const strips: PatternStrip[] = [];
	// MapLibre measures a ring from its last vertex, so its first vertex is as far along as
	// the ring's closing segment is long (`LineBucket.addLine`).
	let distance = closed ? segments[count - 1]!.length : 0;
	segments.forEach((segment, i) => {
		const { a, length, dx, dy, nx, ny } = segment;
		const previous = closed || i > 0 ? segments[(i - 1 + count) % count] : undefined;
		const next = closed || i < count - 1 ? segments[(i + 1) % count] : undefined;

		// In the segment's frame: along it from its start, and across it from its middle,
		// to the side of its normal.
		const toFrame = (x: number, y: number): [number, number] => {
			const along = (x - a.x) * dx + (y - a.y) * dy;
			const across = (x - a.x) * nx + (y - a.y) * ny;
			return [distance + along, width / 2 - across];
		};

		// The ends of the polygon: on the bisector of the join, or square past a cap.
		const end = (
			point: Point,
			neighbour: typeof previous,
			outward: number,
		): [[number, number], [number, number]] => {
			if (!neighbour) {
				const x = point.x + dx * capReach * outward;
				const y = point.y + dy * capReach * outward;
				return [toFrame(x + nx * reach, y + ny * reach), toFrame(x - nx * reach, y - ny * reach)];
			}
			let mx = nx + neighbour.nx;
			let my = ny + neighbour.ny;
			const m = Math.hypot(mx, my);
			// A line that turns back on itself: its bisector is the line itself.
			if (m < 1e-6) return end(point, undefined, outward);
			mx /= m;
			my /= m;
			// Far enough along the bisector to reach `reach` from the segment, but not
			// endlessly far at a sharp turn.
			const r = reach / Math.max(mx * nx + my * ny, 0.1);
			return [
				toFrame(point.x + mx * r, point.y + my * r),
				toFrame(point.x - mx * r, point.y - my * r),
			];
		};

		const [startLeft, startRight] = end(a, previous, -1);
		const [endLeft, endRight] = end(segment.b, next, 1);
		// Screen = a + d · (s - distance) + n · (width / 2 - t).
		strips.push({
			matrix: [
				dx,
				dy,
				-nx,
				-ny,
				a.x - dx * distance + (nx * width) / 2,
				a.y - dy * distance + (ny * width) / 2,
			],
			polygon: [startLeft, endLeft, endRight, startRight],
		});
		distance += length;
	});
	return strips;
}

/**
 * How far one copy of a pattern image reaches along the line, in pixels, as MapLibre GL JS
 * scales it: the image, `imageWidth` × `imageHeight` at its display size, is scaled to the
 * line's width at the zoom level's integer part (`floorWidth`), keeping its aspect ratio,
 * and then scaled with the map from that integer zoom level up to `zoom`, as its tiles are.
 */
export function patternPeriod(
	imageWidth: number,
	imageHeight: number,
	floorWidth: number,
	zoom: number,
): number {
	return ((imageWidth * floorWidth) / imageHeight) * 2 ** (zoom - Math.floor(zoom));
}
