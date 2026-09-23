import { describe, expect, test } from 'vitest';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import {
	CollisionIndex,
	iconBox,
	placeSymbols,
	textBox,
	type Box,
	type CollisionOptions,
	type PlacedSymbol,
} from './collision.js';
import type { IconStyle, SymbolStyle } from '../renderer/types.js';
import type { SpriteEntry } from '../sources/sprite.js';

const black = Color.parse('#000')!;

function label(overrides: Partial<SymbolStyle> = {}): SymbolStyle {
	return {
		text: 'AAAAAAAAAA', // 10 × 0.639 em
		size: 10,
		font: ['noto_sans_regular'],
		anchor: 'center',
		offset: [0, 0],
		rotate: 0,
		color: black,
		opacity: 1,
		haloColor: black,
		haloWidth: 0,
		...overrides,
	};
}

const round = (box: Box): number[] => box.map((v) => Math.round(v * 100) / 100);

describe('textBox', () => {
	test('covers the text around its point, one line high, plus padding', () => {
		// 63.9 px wide, 12 px high, centered on (100, 50), padding 2.
		expect(round(textBox(100, 50, label(), 2))).toEqual([66.05, 42, 133.95, 58]);
	});

	test('follows the anchor and the offset, as the renderers draw', () => {
		expect(round(textBox(100, 50, label({ anchor: 'top-left' }), 0))).toEqual([100, 50, 163.9, 62]);
		expect(round(textBox(100, 50, label({ anchor: 'right', offset: [-1, 2] }), 0))).toEqual([
			26.1, 64, 90, 76,
		]);
	});

	test('covers a rotated label by its bounding box', () => {
		expect(round(textBox(100, 50, label({ rotate: 90 }), 0))).toEqual([94, 18.05, 106, 81.95]);
	});
});

describe('iconBox', () => {
	const sprite: SpriteEntry = {
		width: 40,
		height: 20,
		x: 0,
		y: 0,
		pixelRatio: 2,
		sdf: false,
		sheetDataUri: '',
		sheetWidth: 40,
		sheetHeight: 20,
	};
	const icon = (overrides: Partial<IconStyle> = {}): IconStyle => ({
		image: 'x',
		size: 1,
		anchor: 'center',
		offset: [0, 0],
		rotate: 0,
		opacity: 1,
		sdf: false,
		color: black,
		haloColor: black,
		haloWidth: 0,
		...overrides,
	});

	test('covers the icon at its display size, plus padding', () => {
		expect(iconBox(100, 50, icon(), sprite, [2, 2, 2, 2])).toEqual([88, 43, 112, 57]);
		expect(iconBox(100, 50, icon({ size: 2, anchor: 'bottom' }), sprite, [1, 2, 3, 4])).toEqual([
			76, 29, 122, 53,
		]);
	});
});

describe('CollisionIndex', () => {
	test('finds overlapping boxes, also at negative coordinates', () => {
		const index = new CollisionIndex(100, 100);
		index.insert([-50, -50, -10, -10]);
		index.insert([40, 40, 60, 60]);
		expect(index.collides([-20, -20, 0, 0])).toBe(true);
		expect(index.collides([55, 0, 70, 45])).toBe(true);
		expect(index.collides([60, 60, 80, 80])).toBe(false); // touching is fine
		expect(index.collides([0, 0, 30, 30])).toBe(false);
	});

	test('knows what lies within the image and its 100 px padding', () => {
		const index = new CollisionIndex(100, 100);
		expect(index.isInView([150, 150, 160, 160])).toBe(true);
		expect(index.isInView([210, 0, 220, 10])).toBe(false);
	});
});

describe('placeSymbols', () => {
	const options = (overrides: Partial<CollisionOptions> = {}): CollisionOptions => ({
		textAllowOverlap: false,
		iconAllowOverlap: false,
		textIgnorePlacement: false,
		iconIgnorePlacement: false,
		textOptional: false,
		iconOptional: false,
		...overrides,
	});
	const symbol = (
		boxes: { text?: Box; icon?: Box },
		overrides: Partial<CollisionOptions> = {},
	): PlacedSymbol => ({
		textBox: boxes.text,
		iconBox: boxes.icon,
		options: options(overrides),
		showText: false,
		showIcon: false,
	});
	const place = (...symbols: PlacedSymbol[]): string[] => {
		placeSymbols(symbols, new CollisionIndex(100, 100));
		return symbols.map((s) => (s.showText ? 'T' : '') + (s.showIcon ? 'I' : '') || '-');
	};
	const A: Box = [0, 0, 20, 10];
	const B: Box = [10, 5, 30, 15]; // overlaps A
	const C: Box = [50, 50, 60, 60];

	test('shows a symbol only where nothing was placed before', () => {
		expect(place(symbol({ text: A }), symbol({ text: B }), symbol({ text: C }))).toEqual([
			'T',
			'-',
			'T',
		]);
	});

	test('allow-overlap shows a symbol anyway, ignore-placement lets others overlap it', () => {
		expect(place(symbol({ text: A }), symbol({ text: B }, { textAllowOverlap: true }))).toEqual([
			'T',
			'T',
		]);
		expect(place(symbol({ text: A }, { textIgnorePlacement: true }), symbol({ text: B }))).toEqual([
			'T',
			'T',
		]);
	});

	test('shows a label and its icon together, unless one is optional', () => {
		const blocker = symbol({ text: A });
		expect(place(blocker, symbol({ text: B, icon: C }))).toEqual(['T', '-']);
		expect(place(blocker, symbol({ text: B, icon: C }, { textOptional: true }))).toEqual([
			'T',
			'I',
		]);
		expect(place(blocker, symbol({ text: C, icon: B }, { iconOptional: true }))).toEqual([
			'T',
			'T',
		]);
		// An optional icon does not let the icon stand alone.
		expect(place(blocker, symbol({ text: B, icon: C }, { iconOptional: true }))).toEqual([
			'T',
			'-',
		]);
	});

	test('does not show symbols outside the image and its padding', () => {
		expect(place(symbol({ text: [300, 300, 320, 310] }))).toEqual(['-']);
	});
});
