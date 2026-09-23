import { describe, expect, test } from 'vitest';
import { isBold, textWidth } from './text_metrics.js';

describe('textWidth', () => {
	test('adds up the advance widths of Noto Sans', () => {
		// "A" is 639/1000 em in Noto Sans Regular, the space 260/1000.
		expect(textWidth('A', ['noto_sans_regular'], 10)).toBeCloseTo(6.39);
		expect(textWidth('A A', ['noto_sans_regular'], 10)).toBeCloseTo(15.38);
		expect(textWidth('', ['noto_sans_regular'], 10)).toBe(0);
	});

	test('measures bold text in the bold face', () => {
		const regular = textWidth('Berlin', ['noto_sans_regular'], 16);
		const bold = textWidth('Berlin', ['noto_sans_bold'], 16);
		expect(bold).toBeGreaterThan(regular);
	});

	test('covers Latin, Greek and Cyrillic text', () => {
		for (const text of ['Łódź', 'Αθήνα', 'Москва', 'Hà Nội']) {
			expect(textWidth(text, undefined, 10)).toBeGreaterThan(text.length * 3);
		}
	});

	test('counts CJK characters as one em, and other unknown ones as an average width', () => {
		expect(textWidth('東京', undefined, 10)).toBe(20);
		expect(textWidth('ક', undefined, 10)).toBeCloseTo(5.72);
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
