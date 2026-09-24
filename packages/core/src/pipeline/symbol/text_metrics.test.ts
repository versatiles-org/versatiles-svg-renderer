import { describe, expect, test } from 'vitest';
import {
	breakLines,
	glyphAdvances,
	glyphMetrics,
	isBold,
	tableMetrics,
	textWidth,
} from './text_metrics.js';

describe('textWidth', () => {
	test('adds up the advance widths of Noto Sans', () => {
		// "A" is 639/1000 em in Noto Sans Regular, the space 260/1000.
		expect(textWidth('A', tableMetrics(['noto_sans_regular']), 10)).toBeCloseTo(6.39);
		expect(textWidth('A A', tableMetrics(['noto_sans_regular']), 10)).toBeCloseTo(15.38);
		expect(textWidth('', tableMetrics(['noto_sans_regular']), 10)).toBe(0);
	});

	test('measures bold text in the bold face', () => {
		const regular = textWidth('Berlin', tableMetrics(['noto_sans_regular']), 16);
		const bold = textWidth('Berlin', tableMetrics(['noto_sans_bold']), 16);
		expect(bold).toBeGreaterThan(regular);
	});

	test('covers Latin, Greek and Cyrillic text', () => {
		for (const text of ['Łódź', 'Αθήνα', 'Москва', 'Hà Nội']) {
			expect(textWidth(text, tableMetrics(undefined), 10)).toBeGreaterThan(text.length * 3);
		}
	});

	test('counts CJK characters as one em, and other unknown ones as an average width', () => {
		expect(textWidth('東京', tableMetrics(undefined), 10)).toBe(20);
		expect(textWidth('ક', tableMetrics(undefined), 10)).toBeCloseTo(5.72);
	});
});

describe('glyphMetrics', () => {
	test("measures with the glyphs' advances, and without a glyph by the fallback", () => {
		const glyphs = new Map([[65, { advance: 15 }]]); // "A": 15 px at 24 px per em
		const metrics = glyphMetrics((c) => glyphs.get(c), tableMetrics(undefined));
		expect(metrics.advance('A')).toBe(15 / 24);
		expect(metrics.advance('B')).toBeCloseTo(tableMetrics(undefined).advance('B'));
		expect(textWidth('AA', metrics, 24)).toBe(30);
	});
});

describe('isBold', () => {
	test('reads the weight from the name of the first font', () => {
		expect(isBold(['noto_sans_bold'])).toBe(true);
		expect(isBold(['Open Sans Black', 'Noto Sans Regular'])).toBe(true);
		expect(isBold(['noto_sans_regular', 'noto_sans_bold'])).toBe(false);
		expect(isBold(undefined)).toBe(false);
	});
});

describe('glyphAdvances', () => {
	test('keeps a letter and its combining accent one glyph', () => {
		const { chars, advances } = glyphAdvances('Ae\u0301', tableMetrics(['noto_sans_regular']), 10);
		expect(chars).toEqual(['A', 'e\u0301']);
		expect(advances[0]).toBeCloseTo(6.39);
	});
});

describe('breakLines', () => {
	const fonts = ['noto_sans_regular'];

	test('keeps a label that fits on one line', () => {
		expect(breakLines('Brandenburger Tor', tableMetrics(fonts), 10)).toEqual(['Brandenburger Tor']);
	});

	test('breaks into lines of about equal width, at spaces and hyphens', () => {
		expect(breakLines('Friedrich-Wilhelm-Universität zu Berlin', tableMetrics(fonts), 10)).toEqual([
			'Friedrich-Wilhelm-',
			'Universität zu Berlin',
		]);
		expect(breakLines('aaaa bbbb cccc dddd eeee ffff', tableMetrics(fonts), 5)).toEqual([
			'aaaa bbbb',
			'cccc dddd',
			'eeee ffff',
		]);
	});

	test('does not break after an opening or before a closing parenthesis', () => {
		expect(breakLines('Museum für Naturkunde (Leibniz-Institut)', tableMetrics(fonts), 10)).toEqual(
			['Museum für Naturkunde', '(Leibniz-Institut)'],
		);
	});

	test('always breaks at a newline, also without a maximum width', () => {
		expect(breakLines('Line one\nLine two', tableMetrics(fonts), 10)).toEqual([
			'Line one',
			'Line two',
		]);
		expect(breakLines('Line one\nLine two', tableMetrics(fonts), 0)).toEqual([
			'Line one',
			'Line two',
		]);
		expect(breakLines('A very long label that never breaks', tableMetrics(fonts), 0)).toHaveLength(
			1,
		);
	});

	test('breaks CJK text between characters', () => {
		expect(breakLines('東京都庁第一本庁舎展望室', tableMetrics(undefined), 6)).toEqual([
			'東京都庁第一',
			'本庁舎展望室',
		]);
	});

	test('narrows the lines by the letter spacing', () => {
		expect(breakLines('Brandenburger Tor', tableMetrics(fonts), 10, 0.2)).toEqual([
			'Brandenburger',
			'Tor',
		]);
	});
});
