/**
 * Where a symbol sits relative to its point, shared by every backend so the two cannot
 * drift apart. The text vocabulary is SVG's (`text-anchor` / `dominant-baseline`); the
 * canvas backend translates it to `textAlign` / `textBaseline`.
 */

/** SVG's `text-anchor` values. */
export type TextAlign = 'start' | 'middle' | 'end';

/** The `dominant-baseline` values this renderer emits. */
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
