import { describe, expect, it } from 'vitest';
import { allowsVerticalWritingMode, verticalText } from './vertical.js';

const set = (text: string) => verticalText(Array.from(text));

describe('allowsVerticalWritingMode', () => {
	it('is true for text with a character that stands upright', () => {
		expect(allowsVerticalWritingMode('長安街')).toBe(true);
		expect(allowsVerticalWritingMode('Tokyo 東京')).toBe(true);
		expect(allowsVerticalWritingMode('서울')).toBe(true);
		expect(allowsVerticalWritingMode('\u{20B9F}')).toBe(true); // an ideograph beyond U+FFFF
	});

	it('is false for text without one', () => {
		expect(allowsVerticalWritingMode('Main Street')).toBe(false);
		expect(allowsVerticalWritingMode('القاهرة')).toBe(false);
	});
});

describe('verticalText', () => {
	it('stands ideographs, kana and Hangul upright, but not the long vowel mark', () => {
		// The mark turns with the line, as a bar along it.
		expect(set('東京タワー')).toEqual({
			chars: ['東', '京', 'タ', 'ワ', 'ー'],
			upright: [true, true, true, true, false],
		});
		expect(set('서울').upright).toEqual([true, true]);
	});

	it('lays words and white space on their side', () => {
		expect(set('東京 Tokyo').upright).toEqual([
			true,
			true,
			false,
			false,
			false,
			false,
			false,
			false,
		]);
	});

	it('stands numbers and codes of up to three capitals upright, longer words not', () => {
		expect(set('国道21号').upright).toEqual([true, true, true, true, true]);
		expect(set('JR線').upright).toEqual([true, true, true]);
		expect(set('東ABCD').upright).toEqual([true, false, false, false, false]);
	});

	it('puts punctuation between upright characters in its vertical form', () => {
		expect(set('（東京）')).toEqual({
			chars: ['︵', '東', '京', '︶'],
			upright: [true, true, true, true],
		});
		expect(set('東・京').chars).toEqual(['東', '・', '京']);
		expect(set('1-2東')).toEqual({
			chars: ['1', '︲', '2', '東'],
			upright: [true, true, true, true],
		});
	});

	it('keeps punctuation beside a word on its side as it is', () => {
		expect(set('東(Tokyo)')).toEqual({
			chars: ['東', '(', 'T', 'o', 'k', 'y', 'o', ')'],
			upright: [true, false, false, false, false, false, false, false],
		});
	});
});
