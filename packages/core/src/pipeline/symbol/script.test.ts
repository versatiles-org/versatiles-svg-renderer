import { describe, expect, it } from 'vitest';
import {
	allowsLetterSpacing,
	drawnByFontEngine,
	drawnCharacters,
	labelLines,
	shapeArabic,
	singleLine,
} from './script.js';
import { tableMetrics, type FontMetrics } from './text_metrics.js';

const metrics = tableMetrics(['noto_sans_regular']);
/** Every grapheme one em wide, to break lines predictably. */
const ems: FontMetrics = { advance: () => 1 };

const codePoints = (text: string): number[] => Array.from(text, (char) => char.codePointAt(0)!);

describe('shapeArabic', () => {
	it('gives each letter the shape its neighbours give it', () => {
		// alef lam qaf alef heh reh teh marbuta: "al-Qāhira"
		const { text, source } = shapeArabic('\u0627\u0644\u0642\u0627\u0647\u0631\u0629');
		expect(codePoints(text)).toEqual([
			0xfe8d, // alef, isolated: it does not join forward
			0xfedf, // lam, initial
			0xfed8, // qaf, final: alef after it does not join back
			0xfe8e, // alef, final
			0xfeeb, // heh, initial
			0xfeae, // reh, final
			0xfe93, // teh marbuta, isolated
		]);
		expect(source).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	it('writes lam and alef as one ligature, and maps it back to both', () => {
		// seen lam alef meem: "salām"
		const { text, source } = shapeArabic('\u0633\u0644\u0627\u0645');
		expect(codePoints(text)).toEqual([0xfeb3, 0xfefc, 0xfee1]);
		expect(source).toEqual([0, 1, 3]);
		expect(codePoints(shapeArabic('\u0644\u0627').text)).toEqual([0xfefb]);
	});

	it('leaves text without Arabic as it is', () => {
		expect(shapeArabic('תל אביב 😀')).toEqual({
			text: 'תל אביב 😀',
			source: Array.from({ length: 'תל אביב 😀'.length }, (_, i) => i),
		});
	});
});

describe('labelLines', () => {
	it('keeps left-to-right text as it is', () => {
		expect(labelLines('Brandenburger Tor', metrics, 10)).toEqual([
			{ text: 'Brandenburger Tor', glyphs: 'Brandenburger Tor' },
		]);
	});

	it('puts Hebrew in the order it is drawn, and keeps it as written', () => {
		expect(labelLines('תל אביב', metrics, 10)).toEqual([{ text: 'תל אביב', glyphs: 'ביבא לת' }]);
	});

	it('reorders only the right-to-left run of mixed text', () => {
		expect(labelLines('Tel Aviv (תל אביב) 2', metrics, 0)[0]!.glyphs).toBe('Tel Aviv (ביבא לת) 2');
	});

	it('mirrors brackets in a right-to-left run', () => {
		// "(1) street" in Hebrew: drawn from the right, the brackets turn around.
		expect(labelLines('רחוב (1)', metrics, 0)[0]!.glyphs).toBe('(1) בוחר');
	});

	it('breaks lines as written, then reorders each within its paragraph', () => {
		// "26th of July Street": the number stays to the left of the word before it.
		const lines = labelLines('\u0634\u0627\u0631\u0639 26 \u064a\u0648\u0644\u064a\u0648', ems, 7);
		expect(lines.map((line) => line.text)).toEqual([
			'\u0634\u0627\u0631\u0639 26',
			'\u064a\u0648\u0644\u064a\u0648',
		]);
		// ain, reh, alef, sheen from the left; alef joins no letter after it.
		expect(codePoints(lines[0]!.glyphs)).toEqual([
			0x32, 0x36, 0x20, 0xfec9, 0xfead, 0xfe8e, 0xfeb7,
		]);
	});

	it('takes each paragraph direction from its own text', () => {
		const lines = labelLines('עיר\nCity', metrics, 0);
		expect(lines).toEqual([
			{ text: 'עיר', glyphs: 'ריע' },
			{ text: 'City', glyphs: 'City' },
		]);
	});

	it('drops the bidi controls nothing draws, but keeps them as written', () => {
		expect(labelLines('A\u200fB', metrics, 0)).toEqual([{ text: 'A\u200fB', glyphs: 'AB' }]);
		expect(labelLines('א\u200eב', metrics, 0)[0]!.glyphs).toBe('בא');
	});

	it('keeps a letter and its marks together', () => {
		// yod with sheva, then resh: the start of Jerusalem
		expect(labelLines('י\u05b0ר', metrics, 0)[0]!.glyphs).toBe('רי\u05b0');
	});

	it('trims lines and leaves out empty ones', () => {
		expect(labelLines('  \n Ab  \n\n', metrics, 0)).toEqual([{ text: 'Ab', glyphs: 'Ab' }]);
	});

	it('breaks Arabic measured with the widths of its shapes, as MapLibre does', () => {
		// "Great 26th of July Street": MapLibre breaks it into two lines at 4 ems.
		const street = String.fromCodePoint(
			...[0x634, 0x627, 0x631, 0x639, 0x20, 0x32, 0x36], // "26th Street"
			...[0x20, 0x64a, 0x648, 0x644, 0x64a, 0x648], // "of July"
			...[0x20, 0x627, 0x644, 0x643, 0x628, 0x64a, 0x631], // "the Great"
		);
		expect(labelLines(street, metrics, 4).map((line) => line.text)).toEqual([
			street.slice(0, 7),
			street.slice(8),
		]);
	});
});

describe('singleLine', () => {
	it('is the whole label on one line', () => {
		expect(singleLine('רחוב\nהרצל', metrics)).toEqual({
			text: 'רחוב הרצל',
			glyphs: 'לצרה בוחר',
		});
		expect(singleLine(' ', metrics)).toBeUndefined();
	});
});

describe('drawnCharacters', () => {
	it('is the shaped text without bidi controls', () => {
		expect(codePoints(drawnCharacters('\u200f\u0644\u0627'))).toEqual([0xfefb]);
	});
});

describe('drawnByFontEngine', () => {
	const text = (...codePoints: number[]) => String.fromCodePoint(...codePoints);

	it('is true for scripts whose letters combine', () => {
		expect(drawnByFontEngine(text(0x928, 0x908))).toBe(true); // Devanagari "naī"
		expect(drawnByFontEngine(text(0xe01, 0xe23, 0xe38, 0xe07))).toBe(true); // Thai "krung"
		expect(drawnByFontEngine(text(0x1797, 0x17d2, 0x1793, 0x17c6))).toBe(true); // Khmer
		expect(drawnByFontEngine(text(0x1000))).toBe(true); // Myanmar ka, alone
		expect(drawnByFontEngine(`Old Delhi ${text(0x926, 0x93f)}`)).toBe(true);
	});

	it('is true for a letter with marks of its own', () => {
		expect(drawnByFontEngine(text(0x65, 0x301))).toBe(true); // e and a combining acute
		expect(drawnByFontEngine(text(0x5d9, 0x5b0, 0x5e8))).toBe(true); // Hebrew yod with sheva
		expect(drawnByFontEngine(text(0x628, 0x64e))).toBe(true); // Arabic beh with fatha
	});

	it('is true for Chinese, Japanese and Korean, as MapLibre draws them with local fonts', () => {
		expect(drawnByFontEngine(text(0x6771, 0x4eac))).toBe(true); // Tōkyō, in kanji
		expect(drawnByFontEngine(text(0x30bf, 0x30ef, 0x30fc))).toBe(true); // katakana "tawā"
		expect(drawnByFontEngine(text(0xc11c, 0xc6b8))).toBe(true); // Hangul "Seoul"
		expect(drawnByFontEngine(text(0x20b9f))).toBe(true); // an ideograph beyond U+FFFF
		expect(drawnByFontEngine(`${text(0x6771, 0x4eac)} Tokyo`)).toBe(true);
		expect(drawnByFontEngine(text(0xff21))).toBe(true); // a full-width A
	});

	it('is false for letters glyphs show as they are', () => {
		expect(drawnByFontEngine('Brandenburger Tor')).toBe(false);
		expect(drawnByFontEngine(text(0xe9))).toBe(false); // é, one character
		expect(drawnByFontEngine(text(0x5ea, 0x5dc))).toBe(false); // Hebrew
		expect(drawnByFontEngine(text(0x627, 0x644, 0x642))).toBe(false); // Arabic
		expect(drawnByFontEngine(text(0x1f600))).toBe(false); // one character beyond U+FFFF
		expect(drawnByFontEngine('one\r\ntwo')).toBe(false);
	});
});

describe('allowsLetterSpacing', () => {
	it('is false for a cursive script anywhere in the label', () => {
		expect(allowsLetterSpacing('Main Street')).toBe(true);
		expect(allowsLetterSpacing('תל אביב')).toBe(true);
		expect(allowsLetterSpacing('Cairo \u0627\u0644\u0642\u0627\u0647\u0631\u0629')).toBe(false);
		expect(allowsLetterSpacing('\u0710\u072c\u0718\u072a')).toBe(false); // Syriac
		expect(allowsLetterSpacing('\u1828\u1820')).toBe(false); // Mongolian
	});
});
