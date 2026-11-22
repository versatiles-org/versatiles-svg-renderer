import { describe, expect, it } from 'vitest';
import type { SymbolStyle } from '../../types.js';
import type { FontMetrics } from './text_metrics.js';
import {
	allowsVerticalWritingMode,
	layoutVerticalText,
	uprightAtPoint,
	verticalText,
	withVerticalPunctuation,
} from './vertical.js';

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

describe('withVerticalPunctuation', () => {
	it('puts punctuation in its vertical form unless a neighbour lies on its side', () => {
		expect(withVerticalPunctuation('「東京」')).toBe('﹁東京﹂');
		expect(withVerticalPunctuation('東京 (Tokyo)')).toBe('東京 (Tokyo)');
	});
});

describe('uprightAtPoint', () => {
	it('is true for all but white space and Arabic', () => {
		expect(['北', 'A', '1', '!'].map(uprightAtPoint)).toEqual([true, true, true, true]);
		expect([' ', '\u0628'].map(uprightAtPoint)).toEqual([false, false]);
	});
});

describe('layoutVerticalText', () => {
	/** Every grapheme one em wide. */
	const ems: FontMetrics = { advance: () => 1 };
	const style = { size: 24, anchor: 'center', offset: [0, 0], rotate: 0 } as SymbolStyle;
	const line = (text: string) => ({ text, glyphs: text });
	const round = (v: number): number => Math.round(v * 10) / 10;

	it('reads from the top, each character upright, 2/24 em above its place', () => {
		const { path, box } = layoutVerticalText(100, 100, style, [line('北 京')], 1.2, ems, 0);
		// The space takes its em, but is not drawn.
		expect(path.map((g) => [g.text, round(g.x), round(g.y), g.angle])).toEqual([
			['北', 100, 74, 0],
			['京', 100, 122, 0],
		]);
		expect(box.map(round)).toEqual([85.6, 64, 114.4, 136]);
	});

	it('puts each line to the left of the one before', () => {
		const { path } = layoutVerticalText(100, 100, style, [line('北'), line('京')], 1.2, ems, 0);
		expect(path.map((g) => [g.text, round(g.x), round(g.y)])).toEqual([
			['北', 114.4, 98],
			['京', 85.6, 98],
		]);
	});

	it('anchors and offsets the label before turning it, and turns it with text-rotate', () => {
		const moved = { ...style, anchor: 'left', offset: [1, 0] as [number, number], rotate: 90 };
		const { path } = layoutVerticalText(100, 100, moved, [line('北')], 1.2, ems, 0);
		// Across, the character would be 24 to 48 px right of the point; turned twice, left of it.
		expect(path.map((g) => [round(g.x), round(g.y), g.angle])).toEqual([[66, 100, 90]]);
	});
});
