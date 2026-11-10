import { describe, expect, test } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { encodePNG } from './png_encode.js';

/** The pixels of a PNG file, as a decoder reads them. */
async function decode(png: Uint8Array, width: number, height: number): Promise<number[]> {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.drawImage(await loadImage(Buffer.from(png)), 0, 0);
	return [...ctx.getImageData(0, 0, width, height).data];
}

/** Opaque pixels of a gradient, so every byte differs from its neighbours. */
function gradient(width: number, height: number): Uint8Array {
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		data.set([i % 256, (i >> 8) % 256, (i * 7) % 256, 255], i * 4);
	}
	return data;
}

describe('encodePNG', () => {
	test('writes a PNG file that decodes to the same pixels', async () => {
		const data = gradient(5, 3);
		const png = encodePNG(5, 3, data);
		expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		expect(await decode(png, 5, 3)).toEqual([...data]);
	});

	test('keeps transparent and half transparent pixels, not premultiplied', async () => {
		// a decoder premultiplies on drawing, so only full and no opacity survive exactly
		const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
		expect(await decode(encodePNG(2, 1, data), 2, 1)).toEqual([...data]);
	});

	test('splits pixels beyond one deflate block into several', async () => {
		// 200 × 200 × 4 bytes and a filter byte per row: three blocks
		const data = gradient(200, 200);
		const png = encodePNG(200, 200, data);
		expect(png.length).toBeGreaterThan(data.length);
		expect(await decode(png, 200, 200)).toEqual([...data]);
	});

	test('refuses a size that the pixels do not have', () => {
		expect(() => encodePNG(2, 2, new Uint8Array(15))).toThrow(/needs 16 bytes, not 15/);
		expect(() => encodePNG(0, 2, new Uint8Array(0))).toThrow(/positive whole/);
		expect(() => encodePNG(1.5, 2, new Uint8Array(12))).toThrow(/positive whole/);
	});
});
