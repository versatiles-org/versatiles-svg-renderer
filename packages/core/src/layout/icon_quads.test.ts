import { describe, expect, test } from 'vitest';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { fitIconToText, iconQuads, overlapQuads, quadsBox } from './icon_quads.js';
import type { IconStyle, SpriteEntry } from '../types.js';

const black = Color.parse('#000')!;

const sprite = (overrides: Partial<SpriteEntry> = {}): SpriteEntry => ({
	width: 20,
	height: 10,
	x: 100,
	y: 50,
	pixelRatio: 1,
	sdf: false,
	sheetDataUri: '',
	sheetWidth: 200,
	sheetHeight: 100,
	...overrides,
});
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
/** Each piece as its columns in the sprite image and where they are drawn, horizontally. */
const columns = (style: IconStyle, entry: SpriteEntry) =>
	iconQuads(style, entry).map((q) => [
		q.source.x - entry.x,
		q.source.x - entry.x + q.source.width,
		q.left,
		q.right,
	]);

describe('iconQuads', () => {
	test('draws an icon as one piece, placed by its anchor and offset, scaled by its size', () => {
		const entry = sprite({ pixelRatio: 2 });
		expect(iconQuads(icon({ size: 2, offset: [1, 0] }), entry)).toEqual([
			{ source: { x: 100, y: 50, width: 20, height: 10 }, left: -8, top: -5, right: 12, bottom: 5 },
		]);
		expect(quadsBox(iconQuads(icon({ anchor: 'top-left' }), entry))).toEqual([0, 0, 10, 5]);
	});

	test('stretches a fitted icon without stretch zones as a whole', () => {
		expect(iconQuads(icon({ fit: [-20, -6, 20, 6] }), sprite())).toEqual([
			{
				source: { x: 100, y: 50, width: 20, height: 10 },
				left: -20,
				top: -6,
				right: 20,
				bottom: 6,
			},
		]);
		// icon-size scales the fitted icon, as in MapLibre.
		expect(quadsBox(iconQuads(icon({ fit: [-20, -6, 20, 6], size: 2 }), sprite()))).toEqual([
			-40, -12, 40, 12,
		]);
	});

	test('stretches only the stretch zones, and keeps the parts between them', () => {
		const entry = sprite({ stretchX: [[4, 16]] });
		expect(columns(icon({ fit: [-20, -5, 20, 5] }), entry)).toEqual([
			[0, 4, -20, -16],
			[4, 16, -16, 16],
			[16, 20, 16, 20],
		]);
		// icon-size scales the whole image, the fixed parts too (MapLibre GL JS 6.18).
		expect(columns(icon({ fit: [-20, -5, 20, 5], size: 2 }), entry)).toEqual([
			[0, 4, -40, -32],
			[4, 16, -32, 32],
			[16, 20, 32, 40],
		]);
	});

	test('fits the content area to the box, the rest of the image around it', () => {
		const entry = sprite({ stretchX: [[4, 16]], content: [2, 0, 18, 10] });
		// Pixels 2 and 18 of the image land on the box's sides.
		expect(columns(icon({ fit: [-20, -5, 20, 5] }), entry)).toEqual([
			[0, 4, -22, -18],
			[4, 16, -18, 18],
			[16, 20, 18, 22],
		]);
	});

	test('keeps the aspect ratio of the content where the image asks for it', () => {
		const entry = sprite({
			content: [0, 0, 20, 10],
			textFitWidth: 'proportional',
			textFitHeight: 'proportional',
		});
		// Fitted 12 high, the icon is 24 wide, as the content is twice as wide as high.
		expect(quadsBox(iconQuads(icon({ fit: [-10, -6, 10, 6] }), entry))).toEqual([-12, -6, 12, 6]);
	});
});

describe('overlapQuads', () => {
	test('lets each piece reach a pixel into the next, with as much more of the image', () => {
		// Fixed parts of 4 px at icon-size 2, a stretch zone of 12 px across 64 px.
		const entry = sprite({ stretchX: [[4, 16]], stretchY: [[3, 7]] });
		const style = icon({ fit: [-20, -5, 20, 5], size: 2 });
		const exact = iconQuads(style, entry);
		const drawn = overlapQuads(exact);
		const piece = (quads: typeof exact, x: number, y: number) =>
			quads.find((q) => q.source.x === entry.x + x && q.source.y === entry.y + y)!;
		// The top left corner: 1 px further right and down, half a pixel more of the image.
		expect(piece(exact, 0, 0)).toMatchObject({ right: -32, bottom: -4 });
		expect(piece(drawn, 0, 0)).toMatchObject({
			source: { width: 4.5 },
			left: -40,
			top: -10,
			right: -31,
		});
		// The stretched middle: 1 px further, 12/64 of a pixel more of the image.
		const middle = piece(drawn, 4, 3);
		expect(middle.right - piece(exact, 4, 3).right).toBeCloseTo(1);
		expect(middle.source.width).toBeCloseTo(12 + 12 / 64);
		// The outer edges stay: the icon is as large as before.
		expect(quadsBox(drawn)).toEqual(quadsBox(exact));
		expect(exact).toEqual(iconQuads(style, entry));
	});

	test('reaches no further than the next piece, so not into the next image in the sheet', () => {
		// At a tenth of its size, the stretched middle would need 4.5 px of the image to reach a
		// pixel further; the last column, after it, has only 1 px: the middle ends with the image.
		const entry = sprite({ stretchX: [[1, 19]] });
		const drawn = overlapQuads(iconQuads(icon({ fit: [-20, -5, 20, 5], size: 0.1 }), entry));
		const middle = drawn.find((q) => q.source.x === entry.x + 1)!;
		expect(middle.source.x - entry.x + middle.source.width).toBe(20);
	});

	test('leaves a single piece as it is', () => {
		const quads = iconQuads(icon(), sprite());
		expect(overlapQuads(quads)).toEqual(quads);
	});
});

describe('fitIconToText', () => {
	const text: [number, number, number, number] = [-30, -9, 30, 9];

	test('spans the label plus padding on both axes', () => {
		expect(fitIconToText(icon(), sprite(), text, 'both', [1, 2, 3, 4])).toEqual([-34, -10, 32, 12]);
	});

	test('is in icon units, so that drawn at icon-size it covers the label plus the same padding', () => {
		// MapLibre GL JS 6.18: the padding no longer grows with icon-size.
		const box = fitIconToText(icon({ size: 2 }), sprite(), text, 'both', [1, 2, 3, 4]);
		expect(box).toEqual([-17, -5, 16, 6]);
		expect(box.map((v) => v * 2)).toEqual([-34, -10, 32, 12]);
	});

	test('spans only the width or the height, and centers the icon on the label otherwise', () => {
		expect(fitIconToText(icon(), sprite(), text, 'width', [1, 2, 3, 4])).toEqual([-34, -5, 32, 5]);
		expect(fitIconToText(icon(), sprite(), text, 'height', [1, 2, 3, 4])).toEqual([
			-10, -10, 10, 12,
		]);
	});

	test('moves with icon-offset and ignores icon-anchor', () => {
		expect(
			fitIconToText(
				icon({ offset: [5, -1], anchor: 'left' }),
				sprite(),
				text,
				'both',
				[0, 0, 0, 0],
			),
		).toEqual([-25, -10, 35, 8]);
	});
});
