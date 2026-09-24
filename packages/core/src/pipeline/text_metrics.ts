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

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

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

/**
 * The glyphs of `text` (its graphemes: a letter with its accents stays one), and the
 * advance of each in pixels at `size`, by `metrics`.
 */
export function glyphAdvances(
	text: string,
	metrics: FontMetrics,
	size: number,
): { chars: string[]; advances: number[] } {
	const chars = Array.from(graphemes.segment(text), ({ segment }) => segment);
	return { chars, advances: chars.map((char) => metrics.advance(char) * size) };
}

/** How wide characters are: the advance of a grapheme, in ems. */
export interface FontMetrics {
	advance(grapheme: string): number;
}

/** Metrics from the widths of Noto Sans built into the package, in the weight `fonts` asks for. */
export function tableMetrics(fonts: readonly string[] | undefined): FontMetrics {
	const widths = lookup(isBold(fonts) ? BOLD : REGULAR);
	return {
		advance(grapheme) {
			let total = 0;
			for (const char of grapheme) {
				const c = char.codePointAt(0)!;
				total += widths.get(c) ?? (isWide(c) ? UNITS : DEFAULT_WIDTH);
			}
			return total / UNITS;
		},
	};
}

/**
 * Metrics from a style's glyphs (MapLibre's own): `glyphAt` gives the glyph of a code point,
 * with its advance in pixels at 24 px per em. Characters without a glyph are measured by
 * `fallback`.
 */
export function glyphMetrics(
	glyphAt: (codePoint: number) => { advance: number } | undefined,
	fallback: FontMetrics,
): FontMetrics {
	return {
		advance(grapheme) {
			let total = 0;
			for (const char of grapheme) {
				const glyph = glyphAt(char.codePointAt(0)!);
				total += glyph ? glyph.advance / 24 : fallback.advance(char);
			}
			return total;
		},
	};
}

/** The width of `text` in pixels, at `size` pixels, by `metrics`. */
export function textWidth(text: string, metrics: FontMetrics, size: number): number {
	let total = 0;
	for (const { segment } of graphemes.segment(text)) total += metrics.advance(segment);
	return total * size;
}

/** Characters after which a line may break (MapLibre's `breakable`). */
const BREAKABLE = new Set([
	0x0a, // newline
	0x20, // space
	0x26, // ampersand
	0x29, // right parenthesis
	0x2b, // plus sign
	0x2d, // hyphen-minus
	0x2f, // solidus
	0xad, // soft hyphen
	0xb7, // middle dot
	0x200b, // zero-width space
	0x2010, // hyphen
	0x2013, // en dash
	0x2027, // interpunct
]);

/** Characters that take no width at the end of a line (MapLibre's `whitespace`). */
const WHITESPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);

/** Whether a line may break after `c` without a space: CJK text has no spaces. */
function allowsIdeographicBreaking(c: number): boolean {
	return (
		(c >= 0x2e80 && c <= 0x9fff) || // CJK radicals … unified ideographs, kana
		(c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
		(c >= 0xf900 && c <= 0xfaff) ||
		(c >= 0xff00 && c <= 0xffef) ||
		(c >= 0x20000 && c <= 0x3fffd)
	);
}

interface Break {
	index: number;
	x: number;
	prior: Break | undefined;
	badness: number;
}

/** How far a line is from the target width, plus the penalty of the break (MapLibre's). */
function badness(width: number, target: number, penalty: number, last: boolean): number {
	const raggedness = (width - target) ** 2;
	// The last line is better shorter than the others than longer.
	if (last) return width < target ? raggedness / 2 : raggedness * 2;
	return raggedness + Math.abs(penalty) * penalty;
}

function penaltyOf(c: number, next: number | undefined): number {
	let penalty = 0;
	if (c === 0x0a) penalty -= 10000; // a newline forces the break
	if (c === 0x28 || c === 0xff08) penalty += 50; // not after an opening parenthesis
	if (next === 0x29 || next === 0xff09) penalty += 50; // not before a closing one
	return penalty;
}

function evaluateBreak(
	index: number,
	x: number,
	target: number,
	breaks: Break[],
	penalty: number,
	last: boolean,
): Break {
	let prior: Break | undefined;
	let best = badness(x, target, penalty, last);
	for (const candidate of breaks) {
		const value = badness(x - candidate.x, target, penalty, last) + candidate.badness;
		if (value <= best) {
			prior = candidate;
			best = value;
		}
	}
	return { index, x, prior, badness: best };
}

/**
 * `text` broken into lines of at most about `maxWidth` ems, as MapLibre GL JS breaks point
 * labels (`determineLineBreaks`): at spaces and other breakable characters, and between CJK
 * characters, choosing the breaks that make the lines most even; always at a newline. Each
 * line is trimmed. `letterSpacing` is in ems, as `text-letter-spacing`.
 */
export function breakLines(
	text: string,
	metrics: FontMetrics,
	maxWidth: number,
	letterSpacing = 0,
): string[] {
	const chars = Array.from(graphemes.segment(text), ({ segment }) => segment);
	const codes = chars.map((char) => char.codePointAt(0)!);
	const advances = chars.map((char) => metrics.advance(char) + letterSpacing);
	const lines = (indices: number[]): string[] => {
		const result: string[] = [];
		let start = 0;
		for (const end of [...indices, chars.length]) {
			const line = chars.slice(start, end).join('').trim();
			if (line) result.push(line);
			start = end;
		}
		return result;
	};

	if (!(maxWidth > 0)) return lines(codes.flatMap((c, i) => (c === 0x0a ? [i + 1] : [])));

	// Aim at lines of equal width: the total spread over as many lines as it needs.
	const total = advances.reduce((sum, advance) => sum + advance, 0);
	const target = total / Math.max(1, Math.ceil(total / maxWidth));

	const breaks: Break[] = [];
	let x = 0;
	for (let i = 0; i < codes.length; i++) {
		const c = codes[i]!;
		if (!WHITESPACE.has(c)) x += advances[i]!;
		if (i < codes.length - 1 && (BREAKABLE.has(c) || allowsIdeographicBreaking(c))) {
			breaks.push(evaluateBreak(i + 1, x, target, breaks, penaltyOf(c, codes[i + 1]), false));
		}
	}
	const indices: number[] = [];
	for (let b = evaluateBreak(codes.length, x, target, breaks, 0, true).prior; b; b = b.prior) {
		indices.unshift(b.index);
	}
	return lines(indices);
}
