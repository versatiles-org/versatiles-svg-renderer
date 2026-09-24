import { describe, expect, test, vi } from 'vitest';
import { glyphRangeUrl, loadGlyphRange, parseGlyphs, rangeStart } from './glyphs.js';
import { glyphFile } from './__fixtures__/glyphs.js';

describe('parseGlyphs', () => {
	test('reads the glyphs of a glyph file, with their SDFs and metrics', () => {
		const glyphs = parseGlyphs(
			glyphFile([
				{ id: 65, width: 10, height: 12, left: 1, top: -5, advance: 15 },
				{ id: 32, width: 0, height: 0, advance: 6 },
			]),
		);
		expect([...glyphs.keys()]).toEqual([65, 32]);
		const a = glyphs.get(65)!;
		expect({ ...a, bitmap: a.bitmap.length }).toEqual({
			id: 65,
			bitmap: 16 * 18,
			width: 10,
			height: 12,
			left: 1,
			top: -5,
			advance: 15,
		});
		expect(glyphs.get(32)!.bitmap.length).toBe(0);
	});
});

describe('glyph ranges', () => {
	test('are 256 characters each, named by the style URL', () => {
		expect([rangeStart(65), rangeStart(256), rangeStart(0x4e00)]).toEqual([0, 256, 0x4e00]);
		expect(glyphRangeUrl('https://a/{fontstack}/{range}.pbf', 'Noto Sans Bold', 256)).toBe(
			'https://a/Noto Sans Bold/256-511.pbf',
		);
	});

	test('are loaded with the given fetch, or not at all', async () => {
		const file = glyphFile([{ id: 65, width: 4, height: 4, advance: 10 }]);
		const fetchFn = vi.fn((url: string) =>
			Promise.resolve(
				url.includes('0-255') ? new Response(file) : new Response(null, { status: 404 }),
			),
		);
		const range = await loadGlyphRange('https://a/{fontstack}/{range}.pbf', 'F', 0, fetchFn);
		expect(range?.get(65)?.advance).toBe(10);
		expect(fetchFn).toHaveBeenCalledWith('https://a/F/0-255.pbf');
		expect(
			await loadGlyphRange('https://a/{fontstack}/{range}.pbf', 'F', 256, fetchFn),
		).toBeUndefined();
		const failing = () => Promise.reject(new Error('offline'));
		expect(
			await loadGlyphRange('https://a/{fontstack}/{range}.pbf', 'F', 0, failing),
		).toBeUndefined();
	});
});
