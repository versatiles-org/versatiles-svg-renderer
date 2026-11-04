import { describe, expect, test, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { CanvasPatterns } from './patterns.js';
import type { FillPattern } from '../../types.js';

function makePattern(): FillPattern {
	return {
		name: 'hatch',
		sprite: {
			width: 2,
			height: 2,
			x: 0,
			y: 0,
			pixelRatio: 1,
			sdf: false,
			sheetDataUri: 'data:sheet',
			sheetWidth: 2,
			sheetHeight: 2,
		},
		origin: [0, 0],
	};
}

function makePatterns() {
	const ctx = createCanvas(10, 10).getContext('2d');
	const sheet = createCanvas(2, 2).toBuffer('image/png');
	const patterns = new CanvasPatterns(ctx, createCanvas, 1, () => loadImage(sheet));
	return { ctx, patterns };
}

describe('CanvasPatterns.fill', () => {
	test('creates a canvas pattern once per sprite image', async () => {
		const { ctx, patterns } = makePatterns();
		const create = vi.spyOn(ctx, 'createPattern');
		const first = await patterns.fill(makePattern());
		const second = await patterns.fill(makePattern());
		expect(first).toBe(second);
		expect(create).toHaveBeenCalledTimes(1);
	});

	test('throws if the canvas cannot create the pattern', async () => {
		const { ctx, patterns } = makePatterns();
		vi.spyOn(ctx, 'createPattern').mockReturnValue(null);
		await expect(patterns.fill(makePattern())).rejects.toThrow(
			'could not create a canvas pattern of "hatch"',
		);
	});
});
