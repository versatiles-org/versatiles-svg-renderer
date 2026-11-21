/**
 * Labels in scripts whose letters are not simply set one after the other, left to right, laid
 * out as MapLibre GL JS 6.19 lays them out: Arabic letters take the shape their neighbours give
 * them, and text written right to left is put into the order it is drawn, line by line, by the
 * Unicode Bidirectional Algorithm (`bidi-js`, which MapLibre uses too).
 *
 * A label line therefore exists twice: as written, for whatever draws it as text (an SVG
 * viewer, a canvas), which shapes and orders it itself, and as drawn, for placing its glyphs
 * one by one: as the style's glyphs, or along a line.
 */
import bidiFactory, { type BidiCharTypeName, type EmbeddingLevels } from 'bidi-js';
import { ENCODED_JOINING_TYPES, LIGATURES, PRESENTATION_FORMS } from './arabic_tables.js';
import { breakLineRanges, type FontMetrics } from './text_metrics.js';

const bidi = bidiFactory();

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** One line of a label. */
export interface LabelLine {
	/** As written, in logical order: for drawing as text. */
	text: string;
	/** As drawn: Arabic letters in their shapes, in visual order, without bidi controls. */
	glyphs: string;
}

/**
 * `text` broken into lines (see `breakLineRanges`) and each line put into the order it is
 * drawn, as MapLibre does: the text is shaped first, then broken, and every line is reordered
 * within the paragraph it belongs to. `maxWidth` and `letterSpacing` are in ems.
 */
export function labelLines(
	text: string,
	metrics: FontMetrics,
	maxWidth: number,
	letterSpacing = 0,
): LabelLine[] {
	const shaped = shapeArabic(text);
	const levels = RTL.test(shaped.text) ? bidi.getEmbeddingLevels(shaped.text) : undefined;
	const lines: LabelLine[] = [];
	for (let [start, end] of breakLineRanges(shaped.text, metrics, maxWidth, letterSpacing)) {
		while (start < end && /\s/.test(shaped.text[start]!)) start++;
		while (end > start && /\s/.test(shaped.text[end - 1]!)) end--;
		if (start === end) continue;
		const from = shaped.source[start]!;
		const to = end < shaped.text.length ? shaped.source[end]! : text.length;
		lines.push({
			text: text.slice(from, to).trim(),
			glyphs: levels
				? reorderLine(shaped.text, levels, start, end)
				: shaped.text.slice(start, end).replace(BIDI_CONTROLS_ALL, ''),
		});
	}
	return lines;
}

/** `text` as one line, as along a line: all white space a single space. */
export function singleLine(text: string, metrics: FontMetrics): LabelLine | undefined {
	return labelLines(text.replace(/\s+/g, ' '), metrics, 0)[0];
}

/**
 * The characters a label's glyphs are drawn from: Arabic letters in their shapes, without the
 * bidi controls nothing draws. (Reordering may mirror a bracket, whose twin is all but always
 * in the same glyph range.)
 */
export function drawnCharacters(text: string): string {
	return shapeArabic(text).text.replace(BIDI_CONTROLS_ALL, '');
}

/**
 * Whether the letters of `text` may be spaced apart (`text-letter-spacing`): not in a cursive
 * script, whose joined letters spacing would take apart. As in MapLibre, one cursive letter
 * turns spacing off for the whole label.
 */
export function allowsLetterSpacing(text: string): boolean {
	return !CURSIVE.test(text);
}

/**
 * Whether MapLibre draws `text` with the browser's fonts rather than the style's glyphs: when it
 * has a letter of a script whose letters combine (Indic scripts, Thai, Lao, Tibetan, Myanmar,
 * Khmer and others), or a grapheme of several characters, such as a letter with its marks.
 * Glyphs set one per character side by side cannot show what such letters combine into, so
 * the renderers draw these labels as text too.
 */
export function drawnByFontEngine(text: string): boolean {
	if (COMPLEX.test(text)) return true;
	for (const { segment } of graphemes.segment(text)) {
		if (segment.codePointAt(0)! > 0xffff ? segment.length > 2 : segment.length > 1) {
			// A line break of two characters (CR LF) is not a letter.
			if (!/^\s+$/.test(segment)) return true;
		}
	}
	return false;
}

/**
 * Scripts whose letters combine (MapLibre's `codePointIsInComplexShapingScript`). The ranges
 * that start with a combining mark have classes of their own, with nothing before the mark.
 */
const COMPLEX =
	/[\u0900-\u109F\u1700-\u17FF\u1900-\u194F\u19E0-\u1AAF\u1CC0-\u1CCF\uA800-\uA82F\uA930-\uA95F\uABC0-\uABFF]|[\u1B00-\u1C4F]|[\uA880-\uA8FF]|[\uA980-\uAAFF]|\uD802[\uDE00-\uDE5F]|\uD804[\uDC00-\uDCCF\uDD00-\uDD4F\uDD80-\uDE4F\uDEB0-\uDFFF]|\uD805[\uDC00-\uDCDF\uDD80-\uDE5F\uDE80-\uDF4F]|\uD806[\uDC00-\uDC4F\uDD00-\uDD5F\uDDA0-\uDEAF\uDF00-\uDF7F]|\uD807[\uDC00-\uDCBF\uDD00-\uDDAF\uDEE0-\uDF5F\uDFC0-\uDFFF]|\uD818[\uDD00-\uDD3F]/;

/** Scripts written cursively (MapLibre's `codePointIsInCursiveScript`). */
const CURSIVE =
	/[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Mandaic}\p{Script=Phags_Pa}\p{Script=Manichaean}\p{Script=Psalter_Pahlavi}\p{Script=Hanifi_Rohingya}\p{Script=Sogdian}\p{Script=Duployan}\p{Script=Adlam}]/u;

/**
 * Text that may need reordering: the blocks of right-to-left scripts (Hebrew to Arabic
 * Extended, their presentation forms, and the astral blocks from U+10800 and U+1E800 on), and
 * the controls that start right-to-left text.
 */
const RTL =
	/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u200f\u202b\u202e\u2067]|[\ud802\ud803\ud83a\ud83b]/;

/** Characters that steer the bidirectional algorithm and are not drawn. */
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const BIDI_CONTROLS_ALL = new RegExp(BIDI_CONTROLS.source, 'g');

// --- Reordering (MapLibre's `symbol/bidi.ts`) ---

/** Types rule L1 resets to the paragraph's direction at the end of a line. */
const NEUTRAL_AT_END_OF_LINE = new Set<BidiCharTypeName>(['WS', 'FSI', 'LRI', 'RLI', 'PDI']);
/** Types rule L1 resets wherever they are, with the white space before them. */
const ALWAYS_RESET = new Set<BidiCharTypeName>(['S', 'B']);

interface Cluster {
	text: string;
	level: number;
}

/**
 * The line from `start` to `end` of `text` in visual order: whole grapheme clusters reordered, so a
 * letter keeps its marks, brackets in right-to-left runs mirrored, bidi controls dropped.
 */
function reorderLine(text: string, embedding: EmbeddingLevels, start: number, end: number): string {
	const { levels, paragraphs } = embedding;
	const paragraphLevel = paragraphs.find((p) => start >= p.start && start <= p.end)?.level ?? 0;
	const clusters: Cluster[] = Array.from(
		graphemes.segment(text.slice(start, end)),
		({ segment, index }) => ({ text: segment, level: levels[start + index]! }),
	);

	// Rule L1: white space at the end of the line takes the paragraph's direction.
	let trailing = true;
	for (let i = clusters.length - 1; i >= 0; i--) {
		const cluster = clusters[i]!;
		const type = bidi.getBidiCharTypeName(cluster.text[0]!);
		if (ALWAYS_RESET.has(type)) {
			cluster.level = paragraphLevel;
			trailing = true;
		} else if (trailing && NEUTRAL_AT_END_OF_LINE.has(type)) {
			cluster.level = paragraphLevel;
		} else {
			trailing = false;
		}
	}

	// Rule L2: from the highest level down to the lowest odd one, reverse every run at or above it.
	let highest = paragraphLevel;
	let lowestOdd = Infinity;
	for (const { level } of clusters) {
		highest = Math.max(highest, level);
		lowestOdd = Math.min(lowestOdd, level | 1);
	}
	for (let level = highest; level >= lowestOdd; level--) {
		for (let i = 0; i < clusters.length; i++) {
			if (clusters[i]!.level < level) continue;
			let j = i;
			while (j + 1 < clusters.length && clusters[j + 1]!.level >= level) j++;
			for (let a = i, b = j; a < b; a++, b--) {
				[clusters[a], clusters[b]] = [clusters[b]!, clusters[a]!];
			}
			i = j;
		}
	}

	let result = '';
	for (const cluster of clusters) {
		if (BIDI_CONTROLS.test(cluster.text)) continue;
		result +=
			cluster.level % 2 === 0
				? cluster.text
				: (bidi.getMirroredCharacter(cluster.text) ?? cluster.text);
	}
	return result;
}

// --- Arabic shaping (MapLibre's `symbol/arabic_shaping.ts`) ---

/**
 * How a character joins its neighbours: `D` on both sides, `R` only to the one before it, `L`
 * only to the one after it, `C` joins without being written, `T` is looked through, `U` does
 * not join.
 */
type JoiningType = 'R' | 'L' | 'D' | 'C' | 'U' | 'T';

/** Lam, which is written as one ligature with an alef after it. */
const LAM = 0x0644;

/** Arabic and its presentation forms: text without them is left as it is. */
const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u0870-\u089f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;

/** A letter's shapes, as indices into its entry of `PRESENTATION_FORMS`. */
const ISOLATED = 0;
const FINAL = 1;
const INITIAL = 2;
const MEDIAL = 3;

interface ShapedCharacter {
	codePoint: number;
	/** Where it is in the original text, in code units. */
	index: number;
	type: JoiningType;
	form: number | null;
}

const joiningTypes = new Map<number, JoiningType>();
for (const [type, encoded] of Object.entries(ENCODED_JOINING_TYPES)) {
	// `start,length` ranges in base 36, each start relative to the end of the range before.
	let previousEnd = 0;
	for (const range of encoded.split(';')) {
		const [delta, length] = range.split(',').map((value) => parseInt(value, 36)) as [
			number,
			number,
		];
		const start = previousEnd + delta;
		for (let c = start; c < start + length; c++) joiningTypes.set(c, type as JoiningType);
		previousEnd = start + length;
	}
}

const joinsForward = (type: JoiningType): boolean => type === 'D' || type === 'L' || type === 'C';
const joinsBackward = (type: JoiningType): boolean => type === 'D' || type === 'R' || type === 'C';

function formFor(type: JoiningType, joinedBefore: boolean, joinedAfter: boolean): number | null {
	if (type === 'D') {
		if (joinedBefore) return joinedAfter ? MEDIAL : FINAL;
		return joinedAfter ? INITIAL : ISOLATED;
	}
	if (type === 'R') return joinedBefore ? FINAL : ISOLATED;
	if (type === 'L') return joinedAfter ? INITIAL : ISOLATED;
	return null;
}

/** `text` with Arabic shaped, and for each of its code units the one of `text` it came from. */
export interface ShapedText {
	text: string;
	source: number[];
}

/**
 * `text` with each Arabic letter replaced by the presentation form of the shape it takes
 * between its neighbours, and lam-alef by its ligature, as MapLibre shapes it: a font engine
 * would join the letters, but glyphs placed one by one must be the joined shapes themselves.
 */
export function shapeArabic(text: string): ShapedText {
	if (!ARABIC.test(text)) return { text, source: Array.from({ length: text.length }, (_, i) => i) };

	const characters: ShapedCharacter[] = [];
	let index = 0;
	for (const char of text) {
		const codePoint = char.codePointAt(0)!;
		characters.push({ codePoint, index, type: joiningTypes.get(codePoint) ?? 'U', form: null });
		index += char.length;
	}

	// Letters join across the marks (`T`) between them.
	const visible = characters.filter(({ type }) => type !== 'T');
	visible.forEach((character, i) => {
		const joinedBefore = i > 0 && joinsForward(visible[i - 1]!.type);
		const joinedAfter = i + 1 < visible.length && joinsBackward(visible[i + 1]!.type);
		character.form = formFor(character.type, joinedBefore, joinedAfter);
	});
	// A mark takes its shape from whether its letter joins forward.
	let letterJoinsForward = false;
	for (const character of characters) {
		if (character.type === 'T') {
			character.form = letterJoinsForward ? MEDIAL : ISOLATED;
		} else {
			letterJoinsForward = character.form === INITIAL || character.form === MEDIAL;
		}
	}

	// Lam and alef, marks between them kept after the ligature.
	const result: ShapedCharacter[] = [];
	for (let i = 0; i < characters.length; i++) {
		const lam = characters[i]!;
		let next = i + 1;
		while (next < characters.length && characters[next]!.type === 'T') next++;
		const alef = characters[next];
		const ligature =
			lam.codePoint === LAM && alef && LIGATURES[String.fromCodePoint(LAM, alef.codePoint)];
		if (!ligature) {
			result.push(lam);
			continue;
		}
		const joinedBefore = lam.form === MEDIAL || lam.form === FINAL;
		result.push({ ...lam, codePoint: ligature[joinedBefore ? 1 : 0], type: 'R', form: null });
		result.push(...characters.slice(i + 1, next));
		i = next;
	}

	let shaped = '';
	const source: number[] = [];
	for (const character of result) {
		const char = String.fromCodePoint(presentationForm(character));
		shaped += char;
		source.push(...Array<number>(char.length).fill(character.index));
	}
	return { text: shaped, source };
}

/**
 * The code point of the shape `character` takes: its presentation form, else its isolated
 * form where that shape has none (0 in the table), else the character itself.
 */
function presentationForm(character: ShapedCharacter): number {
	const forms = PRESENTATION_FORMS[character.codePoint];
	if (character.form === null || !forms) return character.codePoint;
	if (forms[character.form]) return forms[character.form]!;
	if (forms[ISOLATED]) return forms[ISOLATED];
	return character.codePoint;
}
