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
 * The glyphs of a label, each `lengths[i]` pixels long along the line, centered at `distance`
 * along `line`: each at its place along the line, turned with it (`reverse`: the other way),
 * moved `offset` pixels along the line and across it, to the right of the reading direction.
 */
function placeAlong(
	line: MeasuredLine,
	distance: number,
	chars: string[],
	lengths: number[],
	offset: [number, number],
	reverse: boolean,
): GlyphPlacement[] {
	const labelLength = lengths.reduce((sum, length) => sum + length, 0);
	const glyphs: GlyphPlacement[] = [];
	let along = -labelLength / 2 + offset[0];
	for (let i = 0; i < chars.length; i++) {
		const center = along + lengths[i]! / 2;
		along += lengths[i]!;
		const at = pointAt(line, reverse ? distance - center : distance + center);
		const angle = reverse ? at.angle + Math.PI : at.angle;
		glyphs.push({
			text: chars[i]!,
			x: at.x - Math.sin(angle) * offset[1],
			y: at.y + Math.cos(angle) * offset[1],
			angle: (angle * 180) / Math.PI,
		});
	}
	return glyphs;
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
	const glyphs = placeAlong(line, distance, chars, advances, offset, false);
	if (keepUpright && glyphs.length > 0) {
		const first = glyphs[0]!;
		const last = glyphs[glyphs.length - 1]!;
		// Upside down: the label reads from right to left (for a single glyph, its angle).
		const upsideDown =
			glyphs.length > 1 ? last.x < first.x : Math.cos((first.angle * Math.PI) / 180) < 0;
		if (upsideDown) return placeAlong(line, distance, chars, advances, offset, true);
	}
	return glyphs;
}

/**
 * Whether a label along a line, laid out as `glyphs`, runs more up and down than across on
 * screen, as MapLibre judges it to set the label vertically: from its first glyph to its last,
 * or by the angle of a single one.
 */
export function runsVertically(glyphs: GlyphPlacement[]): boolean {
	const first = glyphs[0];
	const last = glyphs[glyphs.length - 1];
	if (!first || !last) return false;
	if (glyphs.length === 1) {
		const angle = (first.angle * Math.PI) / 180;
		return Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle));
	}
	return Math.abs(last.y - first.y) > Math.abs(last.x - first.x);
}

/**
 * How far MapLibre draws a character standing upright in vertical text from the middle of its
 * place, towards its top, in ems: its quads are turned around a corner of the em box that
 * puts them 5 of 24 units along the line, which `halfWidthOffsetCorrection` brings back to 2.
 */
const UPRIGHT_SHIFT = 2 / 24;

/**
 * The glyphs of a label set vertically along `line`, as MapLibre sets a label with Chinese,
 * Japanese or Korean along a steep line: read from the top, each character that stands
 * `upright` one em (`size` pixels) long and turned to stand upright on the line, the others on
 * their side as along any line, each its `advances[i]` long; centered at `distance`, moved
 * `offset` pixels along the line and across it.
 */
export function layoutVertically(
	line: MeasuredLine,
	distance: number,
	chars: string[],
	advances: number[],
	upright: boolean[],
	offset: [number, number],
	size: number,
): GlyphPlacement[] {
	const lengths = advances.map((advance, i) => (upright[i] ? size : advance));
	let glyphs = placeAlong(line, distance, chars, lengths, offset, false);
	const first = glyphs[0];
	const last = glyphs[glyphs.length - 1];
	// Read from the top: a label that runs up the line runs the other way.
	const upward =
		first && last && glyphs.length > 1
			? last.y < first.y
			: Math.sin(((first?.angle ?? 0) * Math.PI) / 180) < 0;
	if (upward) glyphs = placeAlong(line, distance, chars, lengths, offset, true);
	return glyphs.map((glyph, i) => {
		if (!upright[i]) return glyph;
		// Turned back by a right angle; its top lies towards the start of the label.
		const radians = (glyph.angle * Math.PI) / 180;
		return {
			text: glyph.text,
			x: glyph.x - Math.cos(radians) * UPRIGHT_SHIFT * size,
			y: glyph.y - Math.sin(radians) * UPRIGHT_SHIFT * size,
			angle: glyph.angle - 90,
		};
	});
}
