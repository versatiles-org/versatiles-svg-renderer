/**
 * Generates `packages/core/src/pipeline/symbol/glyph_widths.ts`: the advance width of every
 * character Noto Sans covers (Latin, Greek, Cyrillic, Vietnamese and Devanagari), of Arabic,
 * with its presentation forms, and Hebrew, and of the scripts whose letters combine (Indic
 * scripts, Thai, Lao, Myanmar, Khmer, Balinese, Javanese) from their Noto Sans fonts, in regular
 * and bold, so the pipeline can measure label text without a font engine. Both renderers then
 * drop the same labels in collision detection, and the widths match the glyphs MapLibre GL JS
 * uses for styles that name Noto Sans, like the VersaTiles styles, whose Noto Sans includes
 * these fonts. Letters that combine are measured by the width each adds between two
 * consonants, so a virama narrows a conjunct by about as much as it is narrower than its
 * letters.
 *
 * Run with `npx tsx scripts/generate-glyph-widths.ts` after updating any `@fontsource/noto-sans`
 * package.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const root = resolve(import.meta.dirname, '..');
const fontsource = resolve(root, 'node_modules/@fontsource');
const output = resolve(root, 'packages/core/src/pipeline/symbol/glyph_widths.ts');

/** A fontsource package to measure, and the subsets to take from it. */
interface Font {
	name: string;
	subsets: string[];
	/**
	 * For a script whose letters combine (see `script.ts`), a consonant to measure each
	 * character between: alone, a vowel sign would be measured with the dotted circle a font
	 * engine draws it on, not as the width it adds to its letter, and a virama as itself, not
	 * as the conjunct it joins two consonants into.
	 */
	base?: number;
}

/**
 * The fonts to measure. A code point is measured with the first font that covers it, so the
 * fonts after Noto Sans add only their scripts: those the VersaTiles Noto Sans includes.
 */
const FONTS: Font[] = [
	{
		name: 'noto-sans',
		subsets: ['latin', 'latin-ext', 'greek', 'greek-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese'],
	},
	{ name: 'noto-sans-arabic', subsets: ['arabic'] },
	{ name: 'noto-sans-hebrew', subsets: ['hebrew'] },
	{ name: 'noto-sans', subsets: ['devanagari'], base: 0x0915 },
	{ name: 'noto-sans-bengali', subsets: ['bengali'], base: 0x0995 },
	{ name: 'noto-sans-gurmukhi', subsets: ['gurmukhi'], base: 0x0a15 },
	{ name: 'noto-sans-gujarati', subsets: ['gujarati'], base: 0x0a95 },
	{ name: 'noto-sans-oriya', subsets: ['oriya'], base: 0x0b15 },
	{ name: 'noto-sans-tamil', subsets: ['tamil'], base: 0x0b95 },
	{ name: 'noto-sans-kannada', subsets: ['kannada'], base: 0x0c95 },
	{ name: 'noto-sans-sinhala', subsets: ['sinhala'], base: 0x0d9a },
	{ name: 'noto-sans-thai', subsets: ['thai'], base: 0x0e01 },
	{ name: 'noto-sans-lao', subsets: ['lao'], base: 0x0e81 },
	{ name: 'noto-sans-myanmar', subsets: ['myanmar'], base: 0x1000 },
	{ name: 'noto-sans-khmer', subsets: ['khmer'], base: 0x1780 },
	{ name: 'noto-sans-balinese', subsets: ['balinese'], base: 0x1b13 },
	{ name: 'noto-sans-javanese', subsets: ['javanese'], base: 0xa98f },
];
/** Widths are stored in thousandths of an em. */
const UNITS = 1000;

/** The code points of `font`'s subsets, from the `unicode-range`s of fontsource's CSS. */
function codePoints(font: Font, weight: number): Set<number> {
	const css = readFileSync(resolve(fontsource, font.name, `${String(weight)}.css`), 'utf8');
	const file = new RegExp(`${font.name}-([a-z-]+)-\\d+-normal\\.woff2`);
	const result = new Set<number>();
	for (const face of css.split('@font-face').slice(1)) {
		const subset = file.exec(face)?.[1];
		if (!subset || !font.subsets.includes(subset)) continue;
		const range = /unicode-range:([^;]*)/.exec(face)?.[1] ?? '';
		for (const part of range.split(',')) {
			const [from, to] = part
				.trim()
				.replace(/^U\+/i, '')
				.split('-')
				.map((hex) => parseInt(hex, 16));
			for (let c = from!; c <= (to ?? from!); c++) {
				// Control characters never appear in labels (and NUL cannot be measured).
				if (c >= 0x20 && (c < 0x7f || c > 0x9f)) result.add(c);
			}
		}
	}
	return result;
}

/** The width of every code point the fonts cover, in `weight`, by code point. */
function measure(weight: number): Map<number, number> {
	const ctx = createCanvas(10, 10).getContext('2d');
	const widths = new Map<number, number>();
	for (const font of FONTS) {
		// Each font a family of its own, so that each code point is measured in the font it is from.
		const family = `Measure ${font.name} ${font.subsets.join(' ')} ${String(weight)}`;
		for (const subset of font.subsets) {
			const file = `${font.name}-${subset}-${String(weight)}-normal.woff2`;
			GlobalFonts.registerFromPath(resolve(fontsource, font.name, 'files', file), family);
		}
		ctx.font = `${String(UNITS)}px "${family}"`;
		const width = (text: string): number => ctx.measureText(text).width;
		const base = font.base === undefined ? undefined : String.fromCodePoint(font.base);
		for (const c of codePoints(font, weight)) {
			if (widths.has(c)) continue;
			const char = String.fromCodePoint(c);
			// Combining marks and other zero-width characters are kept: they add nothing. Between
			// two consonants, a vowel sign adds its width, and a virama what the conjunct it makes
			// saves: less than nothing.
			const added = base ? width(base + char + base) - 2 * width(base) : width(char);
			widths.set(c, Math.round(added));
		}
	}
	return new Map([...widths].sort(([a], [b]) => a - b));
}

/** Runs of consecutive code points, as `[first code point, ...widths]`, to keep the file small. */
function runs(widths: Map<number, number>): number[][] {
	const result: number[][] = [];
	let run: number[] | undefined;
	let next = -1;
	for (const [c, width] of widths) {
		if (c !== next || !run) {
			run = [c];
			result.push(run);
		}
		run.push(width);
		next = c + 1;
	}
	return result;
}

const table = (weight: number): string =>
	runs(measure(weight))
		.map((run) => `\t[${run.join(',')}],`)
		.join('\n');

writeFileSync(
	output,
	`// Generated by scripts/generate-glyph-widths.ts from Noto Sans and the Noto Sans fonts of other
// scripts (@fontsource/noto-sans, @fontsource/noto-sans-*). Do not edit.

/** Advance widths in thousandths of an em, as runs: \`[first code point, ...widths]\`. */
export type GlyphWidthRuns = number[][];

/** Noto Sans Regular, with the other scripts' Regular. */
export const REGULAR: GlyphWidthRuns = [
${table(400)}
];

/** Noto Sans Bold, with the other scripts' Bold. */
export const BOLD: GlyphWidthRuns = [
${table(700)}
];
`,
);
console.log(`Written ${output}`);
