/**
 * Where a symbol sits relative to its point, shared by the pipeline and every backend so
 * they cannot drift apart. The text vocabulary is SVG's (`text-anchor` / `dominant-baseline`).
 */

/** SVG's `text-anchor` values. */
export type TextAlign = 'start' | 'middle' | 'end';

/** Which edge of a block of lines, or its middle, is at the label's point. */
export type TextBaseline = 'central' | 'text-before-edge' | 'text-after-edge';

export function mapTextAnchor(anchor: string): [TextAlign, TextBaseline] {
	switch (anchor) {
		case 'left':
			return ['start', 'central'];
		case 'right':
			return ['end', 'central'];
		case 'top':
			return ['middle', 'text-before-edge'];
		case 'bottom':
			return ['middle', 'text-after-edge'];
		case 'top-left':
			return ['start', 'text-before-edge'];
		case 'top-right':
			return ['end', 'text-before-edge'];
		case 'bottom-left':
			return ['start', 'text-after-edge'];
		case 'bottom-right':
			return ['end', 'text-after-edge'];
		default:
			return ['middle', 'central'];
	}
}

export function mapIconAnchor(anchor: string, w: number, h: number): [number, number] {
	switch (anchor) {
		case 'left':
			return [0, -h / 2];
		case 'right':
			return [-w, -h / 2];
		case 'top':
			return [-w / 2, 0];
		case 'bottom':
			return [-w / 2, -h];
		case 'top-left':
			return [0, 0];
		case 'top-right':
			return [-w, 0];
		case 'bottom-left':
			return [0, -h];
		case 'bottom-right':
			return [-w, -h];
		default:
			return [-w / 2, -h / 2];
	}
}

/** SVG's `text-anchor` for a `text-justify`. */
export const JUSTIFY_ANCHOR = { left: 'start', center: 'middle', right: 'end' } as const;

/**
 * How far to move text with `letter-spacing` so its glyphs sit where MapLibre puts them:
 * SVG and canvas add the spacing after the last character too, which moves centered text
 * left by half of it, and right-aligned text by all of it.
 */
export function letterSpacingShift(spacing: number, anchor: 'start' | 'middle' | 'end'): number {
	return anchor === 'middle' ? spacing / 2 : anchor === 'end' ? spacing : 0;
}

/**
 * How far below the middle of a line of text its alphabetic baseline lies, in ems, where
 * MapLibre puts it. Its glyphs hang 17 of 24 px above the middle (`SHAPING_DEFAULT_OFFSET`);
 * the glyph server's have their baseline 24 px below that, the glyphs MapLibre draws itself
 * from the browser's fonts 27.5 px (its `topAdjustment`). Placed by these numbers, text sits
 * where MapLibre's does whatever metrics the font engine gives the font.
 */
export const TEXT_BASELINE = { server: 7 / 24, local: 10.5 / 24 } as const;

/**
 * How wide a stroke along each letter's outline draws a label's halo, in pixels, as MapLibre
 * draws it (`symbol_sdf.fragment.glsl`): `text-halo-width` beyond the outline, so twice that
 * on both sides; but no further than its glyphs' distance field reaches, 3 of 24 pixels per
 * em beyond their ink (the glyph server's buffer, and the one MapLibre draws its own glyphs
 * with). Wider still, MapLibre fills each glyph's box instead.
 */
export function haloStroke(haloWidth: number, size: number): number {
	return 2 * Math.max(0, Math.min(haloWidth, (size * 3) / 24));
}
