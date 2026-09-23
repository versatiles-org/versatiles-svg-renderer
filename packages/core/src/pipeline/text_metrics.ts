/**
 * The width of label text, measured without a font engine: from the advance widths of
 * Noto Sans (see `glyph_widths.ts`). It serves collision detection, which both renderers
 * share, so they drop the same labels; the text itself is drawn in whatever font the
 * renderer resolves.
 */
import { BOLD, REGULAR, type GlyphWidthRuns } from './glyph_widths.js';

/** Thousandths of an em, as in the tables. */
const UNITS = 1000;

/** The width of a character missing from the tables, if it is not wide (below). */
const DEFAULT_WIDTH = 572; // Noto Sans' digits, a typical Latin width

const lookups = new Map<GlyphWidthRuns, Map<number, number>>();

function lookup(runs: GlyphWidthRuns): Map<number, number> {
	let widths = lookups.get(runs);
	if (!widths) {
		widths = new Map();
		for (const [first, ...run] of runs) {
			run.forEach((width, i) => widths!.set(first! + i, width));
		}
		lookups.set(runs, widths);
	}
	return widths;
}

/** Whether `c` is a full-width character: CJK, kana, Hangul, full-width forms. */
function isWide(c: number): boolean {
	return (
		(c >= 0x1100 && c <= 0x115f) || // Hangul Jamo
		(c >= 0x2e80 && c <= 0xa4cf) || // CJK radicals … Yi
		(c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
		(c >= 0xf900 && c <= 0xfaff) || // CJK compatibility ideographs
		(c >= 0xfe30 && c <= 0xfe4f) || // CJK compatibility forms
		(c >= 0xff00 && c <= 0xff60) || // full-width forms
		(c >= 0xffe0 && c <= 0xffe6) ||
		(c >= 0x20000 && c <= 0x3fffd) // CJK extensions
	);
}

/** Whether a font list asks for a bold face, judged by the name of its first font. */
export function isBold(fonts: readonly string[] | undefined): boolean {
	const name = fonts?.[0] ?? '';
	return /bold|black|heavy/i.test(name);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The glyphs of `text` (its graphemes: a letter with its accents stays one), and the
 * advance of each in pixels, set in `fonts` at `size`.
 */
export function glyphAdvances(
	text: string,
	fonts: readonly string[] | undefined,
	size: number,
): { chars: string[]; advances: number[] } {
	const chars = Array.from(graphemes.segment(text), ({ segment }) => segment);
	return { chars, advances: chars.map((char) => textWidth(char, fonts, size)) };
}

/** The width of `text` in pixels, set in `fonts` at `size` pixels. */
export function textWidth(
	text: string,
	fonts: readonly string[] | undefined,
	size: number,
): number {
	const widths = lookup(isBold(fonts) ? BOLD : REGULAR);
	let total = 0;
	for (const char of text) {
		const c = char.codePointAt(0)!;
		total += widths.get(c) ?? (isWide(c) ? UNITS : DEFAULT_WIDTH);
	}
	return (total / UNITS) * size;
}
