/**
 * Labels along lines (`symbol-placement: "line"` and `"line-center"`), as MapLibre GL JS
 * places them: anchors repeated along each line (`get_anchors.ts`), skipped where the line
 * bends too much for the label (`check_max_angle.ts`), and the text laid out glyph by glyph
 * along the line, each glyph turned with it and the whole label kept upright.
 */
import type { Point2D } from '../../geo/index.js';
import type { GlyphPlacement } from '../../types.js';

/** A line with the distance of each vertex from its start, in pixels. */
export interface MeasuredLine {
	points: Point2D[];
	/** `distances[i]` is the distance from the start to `points[i]`. */
	distances: number[];
	length: number;
}

export function measureLine(points: Point2D[]): MeasuredLine {
	const distances = [0];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]!;
		const b = points[i]!;
		distances.push(distances[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
	}
	return { points, distances, length: distances[distances.length - 1] ?? 0 };
}

/** The point at `distance` along `line`, and the direction of the line there in radians. */
export function pointAt(
	line: MeasuredLine,
	distance: number,
): { x: number; y: number; angle: number } {
	const { points, distances } = line;
	let i = 1;
	while (i < points.length - 1 && distances[i]! < distance) i++;
	const a = points[i - 1]!;
	const b = points[i]!;
	const segment = distances[i]! - distances[i - 1]!;
	const t = segment > 0 ? (distance - distances[i - 1]!) / segment : 0;
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		angle: Math.atan2(b.y - a.y, b.x - a.x),
	};
}

/**
 * The distances along `line` where labels of `labelLength` pixels are placed: every
 * `spacing` pixels where the whole label fits on the line, as MapLibre's `getAnchors`;
 * where none fits that way but the line is long enough, once in its middle. `"line-center"`
 * places only the middle one. `textSize` sets the offset of the first anchor.
 */
export function lineAnchors(
	line: MeasuredLine,
	labelLength: number,
	spacing: number,
	textSize: number,
	placement: string,
): number[] {
	const { length } = line;
	if (length < labelLength || length <= 0) return [];
	if (placement === 'line-center') return [length / 2];

	// A label long relative to the spacing gets more room.
	if (spacing - labelLength < spacing / 4) spacing = labelLength + spacing / 4;
	// The first anchor: half the label plus two ems from the start (MapLibre's offset for a
	// line that is not continued from another tile).
	const offset = (labelLength / 2 + textSize * 2) % spacing;
	const anchors: number[] = [];
	for (let distance = offset; distance <= length; distance += spacing) {
		if (distance - labelLength / 2 >= 0 && distance + labelLength / 2 <= length) {
			anchors.push(distance);
		}
	}
	if (anchors.length === 0) anchors.push(length / 2);
	return anchors;
}

/**
 * Whether the line bends by no more than `maxAngle` (radians) within any `windowSize`
 * pixels of the stretch a label of `labelLength` centered at `distance` covers, as
 * MapLibre's `checkMaxAngle`.
 */
export function fitsMaxAngle(
	line: MeasuredLine,
	distance: number,
	labelLength: number,
	windowSize: number,
	maxAngle: number,
): boolean {
	const { points, distances } = line;
	const from = distance - labelLength / 2;
	const to = distance + labelLength / 2;
	const corners: { distance: number; angle: number }[] = [];
	let total = 0;
	for (let i = 1; i < points.length - 1; i++) {
		const at = distances[i]!;
		if (at <= from) continue;
		if (at >= to) break;
		const prev = points[i - 1]!;
		const current = points[i]!;
		const next = points[i + 1]!;
		let delta =
			Math.atan2(current.y - prev.y, current.x - prev.x) -
			Math.atan2(next.y - current.y, next.x - current.x);
		delta = Math.abs(((delta + 3 * Math.PI) % (Math.PI * 2)) - Math.PI);
		corners.push({ distance: at, angle: delta });
		total += delta;
		while (at - corners[0]!.distance > windowSize) total -= corners.shift()!.angle;
		if (total > maxAngle) return false;
	}
	return true;
}

/**
 * The glyphs of a label of `chars` (with their `advances` in pixels) centered at
 * `distance` along `line`: each at its place along the line, turned with it, moved
 * `offset` pixels along the line and across it (`text-offset`, in pixels). With
 * `keepUpright`, a label that would read upside down runs the other way.
 */
export function layoutAlongLine(
	line: MeasuredLine,
	distance: number,
	chars: string[],
	advances: number[],
	offset: [number, number],
	keepUpright: boolean,
): GlyphPlacement[] {
	const labelLength = advances.reduce((sum, width) => sum + width, 0);
	const place = (reverse: boolean): GlyphPlacement[] => {
		const glyphs: GlyphPlacement[] = [];
		let along = -labelLength / 2 + offset[0];
		for (let i = 0; i < chars.length; i++) {
			const center = along + advances[i]! / 2;
			along += advances[i]!;
			const at = pointAt(line, reverse ? distance - center : distance + center);
			const angle = reverse ? at.angle + Math.PI : at.angle;
			// The offset across the line points to the right of the reading direction.
			glyphs.push({
				text: chars[i]!,
				x: at.x - Math.sin(angle) * offset[1],
				y: at.y + Math.cos(angle) * offset[1],
				angle: (angle * 180) / Math.PI,
			});
		}
		return glyphs;
	};
	const glyphs = place(false);
	if (keepUpright && glyphs.length > 0) {
		const first = glyphs[0]!;
		const last = glyphs[glyphs.length - 1]!;
		// Upside down: the label reads from right to left (for a single glyph, its angle).
		const upsideDown =
			glyphs.length > 1 ? last.x < first.x : Math.cos((first.angle * Math.PI) / 180) < 0;
		if (upsideDown) return place(true);
	}
	return glyphs;
}
