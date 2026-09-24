/**
 * Where a label may be placed around its point with `text-variable-anchor` or
 * `text-variable-anchor-offset`, and how `text-radial-offset` moves it, as MapLibre GL JS
 * computes it (`variable_text_anchor.ts`). Offsets are in ems of the label's size.
 */

/** One place to try: the label's anchor there, and its offset. */
export interface AnchorOffset {
	anchor: string;
	offset: [number, number];
}

/**
 * How far MapLibre moves a label anchored at its top or bottom, besides the offset: its
 * glyphs "start" at the baseline, 7 of 24 units below the top of their box.
 */
const BASELINE_OFFSET = 7 / 24;

/** The offset `radius` ems from the point, towards `anchor`'s side of the label. */
export function radialOffset(anchor: string, radius: number): [number, number] {
	const r = Math.max(0, radius);
	const diagonal = r / Math.SQRT2;
	let x = 0;
	let y = 0;
	if (anchor === 'top-right' || anchor === 'top-left') y = diagonal - BASELINE_OFFSET;
	else if (anchor === 'bottom-right' || anchor === 'bottom-left') y = -diagonal + BASELINE_OFFSET;
	else if (anchor === 'bottom') y = -r + BASELINE_OFFSET;
	else if (anchor === 'top') y = r - BASELINE_OFFSET;
	if (anchor === 'top-right' || anchor === 'bottom-right') x = -diagonal;
	else if (anchor === 'top-left' || anchor === 'bottom-left') x = diagonal;
	else if (anchor === 'left') x = r;
	else if (anchor === 'right') x = -r;
	return [x, y];
}

/** `text-offset` for a variable anchor: its size, pointing away from `anchor`'s side. */
function textOffsetFor(anchor: string, [offsetX, offsetY]: [number, number]): [number, number] {
	const ox = Math.abs(offsetX);
	const oy = Math.abs(offsetY);
	let x = 0;
	let y = 0;
	if (anchor.startsWith('top')) y = oy - BASELINE_OFFSET;
	else if (anchor.startsWith('bottom')) y = -oy + BASELINE_OFFSET;
	if (anchor.endsWith('right')) x = -ox;
	else if (anchor.endsWith('left')) x = ox;
	return [x, y];
}

/**
 * The places to try for a label, in order: from `text-variable-anchor-offset` if set, else
 * from `text-variable-anchor` with `text-radial-offset` (if the style sets it) or
 * `text-offset`. `undefined` if the label has one anchor only.
 */
export function anchorOffsets(options: {
	variableAnchorOffset: unknown;
	variableAnchor: unknown;
	radialOffset: number | undefined;
	textOffset: [number, number];
}): AnchorOffset[] | undefined {
	const collection = options.variableAnchorOffset as { values?: unknown[] } | undefined;
	if (collection?.values) {
		const result: AnchorOffset[] = [];
		for (let i = 0; i + 1 < collection.values.length; i += 2) {
			const anchor = collection.values[i] as string;
			const [x, y] = collection.values[i + 1] as [number, number];
			const shift = anchor.startsWith('top')
				? -BASELINE_OFFSET
				: anchor.startsWith('bottom')
					? BASELINE_OFFSET
					: 0;
			result.push({ anchor, offset: [x, y + shift] });
		}
		return result;
	}
	if (!Array.isArray(options.variableAnchor) || options.variableAnchor.length === 0) {
		return undefined;
	}
	return (options.variableAnchor as string[]).map((anchor) => ({
		anchor,
		offset:
			options.radialOffset !== undefined
				? radialOffset(anchor, options.radialOffset)
				: textOffsetFor(anchor, options.textOffset),
	}));
}
