/**
 * The dashes of a line with `line-dasharray`, shared by every backend, as MapLibre GL JS
 * draws them (`line_sdf.vertex.glsl`, `LineAtlas`).
 */

/** A dash pattern in pixels. */
export interface LineDash {
	/** The lengths of dashes and gaps in turn, starting with a dash: an even number of them. */
	lengths: number[];
	/** How far into the pattern a line starts. */
	offset: number;
}

/**
 * The dash pattern of `dasharray`, or undefined for a line without dashes.
 *
 * MapLibre measures a dash array in line widths, but not in the width the line is drawn
 * with: in its width at the zoom level's integer part (`floorWidth`), scaled with the map
 * from that integer zoom level up to `zoom`, as its tiles are. And where a dash array has
 * an odd number of lengths, it is not repeated to an even one, as SVG and the canvas do: its
 * last and first dash are joined to one.
 */
export function dashPattern(
	dasharray: number[] | undefined,
	floorWidth: number,
	zoom: number,
): LineDash | undefined {
	if (!dasharray || dasharray.length === 0) return undefined;
	const unit = floorWidth * 2 ** (zoom - Math.floor(zoom));
	if (!(unit > 0)) return undefined;
	const lengths = dasharray.map((length) => Math.max(length, 0) * unit);
	let offset = 0;
	if (lengths.length % 2 === 1) {
		// A single length is a dash without a gap.
		if (lengths.length === 1) return undefined;
		// The last dash goes before the first: the pattern starts that far into their sum.
		offset = lengths.pop()!;
		lengths[0]! += offset;
	}
	// Without a gap, the line is solid.
	const hasGap = lengths.some((length, i) => i % 2 === 1 && length > 0);
	return hasGap ? { lengths, offset } : undefined;
}

/** `offset` within one period of `dash`, for a line that starts `start` pixels in. */
export function dashOffset(dash: LineDash, start: number): number {
	const period = dash.lengths.reduce((sum, length) => sum + length, 0);
	const offset = (dash.offset + start) % period;
	return offset < 0 ? offset + period : offset;
}

/**
 * How far along a ring its first vertex is: MapLibre measures a ring from its last vertex,
 * so by the length of its closing segment (`LineBucket.addLine`).
 */
export function closingLength(ring: { x: number; y: number }[]): number {
	const first = ring[0];
	const last = ring[ring.length - 1];
	return first && last ? Math.hypot(first.x - last.x, first.y - last.y) : 0;
}
