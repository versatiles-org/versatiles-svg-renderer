import { describe, expect, test, vi } from 'vitest';
import type { SpriteEntry } from '../types.js';
import { imageAtlas, withImages, type StyleImage } from './images.js';

const red = (width: number, height: number): Uint8Array =>
	new Uint8Array(width * height * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));

describe('imageAtlas', () => {
	test('puts each image on a sheet of its own, as a PNG data URI', () => {
		const images: StyleImage[] = [
			{ id: 'arrow', width: 4, height: 2, data: red(4, 2), pixelRatio: 2, sdf: true },
			{ id: 'pattern', width: 3, height: 3, data: red(3, 3) },
		];
		const atlas = imageAtlas(images, vi.fn());
		const arrow = atlas.get('arrow');
		expect(arrow?.sheetDataUri).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
		expect({ ...arrow, sheetDataUri: 'the PNG' }).toEqual({
			width: 4,
			height: 2,
			x: 0,
			y: 0,
			pixelRatio: 2,
			sdf: true,
			sheetDataUri: 'the PNG',
			sheetWidth: 4,
			sheetHeight: 2,
		});
		// by default not SDF, at one image pixel per map pixel
		expect(atlas.get('pattern')).toMatchObject({ pixelRatio: 1, sdf: false, sheetWidth: 3 });
	});

	test('leaves out what cannot be drawn, with a warning', () => {
		const warn = vi.fn<(message: string) => void>();
		const atlas = imageAtlas(
			[
				{ id: 'short', width: 2, height: 2, data: new Uint8Array(12) },
				{ id: 'flat', width: 2, height: 2, data: red(2, 2), pixelRatio: 0 },
				{ id: 'twice', width: 1, height: 1, data: red(1, 1) },
				{ id: 'twice', width: 2, height: 2, data: red(2, 2) },
			],
			warn,
		);
		expect([...atlas.keys()]).toEqual(['twice']);
		expect(atlas.get('twice')?.width).toBe(1);
		expect(warn.mock.calls.map(([message]) => message)).toEqual([
			expect.stringMatching(/"short".*needs 16 bytes, not 12/),
			expect.stringMatching(/"flat".*pixelRatio/),
			expect.stringMatching(/"twice" is given twice/),
		]);
	});
});

describe('withImages', () => {
	const entry = (sheetDataUri: string): SpriteEntry => ({
		width: 1,
		height: 1,
		x: 0,
		y: 0,
		pixelRatio: 1,
		sdf: false,
		sheetDataUri,
		sheetWidth: 1,
		sheetHeight: 1,
	});

	test('adds the images to the sprite, which keeps an image of the same id, like map.addImage', () => {
		const warn = vi.fn();
		const sprite = new Map([['pin', entry('sprite')]]);
		const images = new Map([
			['pin', entry('image')],
			['arrow', entry('image')],
		]);
		const atlas = withImages(sprite, images, warn);
		expect(atlas.get('pin')?.sheetDataUri).toBe('sprite');
		expect(atlas.get('arrow')?.sheetDataUri).toBe('image');
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('"pin" in "images" is in the sprite too'),
		);
		// the sprite's atlas itself stays as it is
		expect(sprite.size).toBe(1);
	});
});
