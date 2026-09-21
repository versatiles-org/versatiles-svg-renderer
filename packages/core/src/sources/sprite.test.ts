import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { loadSpriteAtlas } from './sprite.js';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

function makeStyle(sprite?: string | { id: string; url: string }[]): StyleSpecification {
	return {
		version: 8,
		sources: {},
		layers: [],
		sprite: sprite,
	};
}

describe('loadSpriteAtlas', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test('returns empty atlas when no sprite defined', async () => {
		const atlas = await loadSpriteAtlas(makeStyle());
		expect(atlas.size).toBe(0);
	});

	test('loads sprite from string URL', async () => {
		const spriteJson = {
			airport: { x: 0, y: 0, width: 32, height: 32, pixelRatio: 1 },
			park: { x: 32, y: 0, width: 24, height: 24, pixelRatio: 1 },
		};
		const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.endsWith('.json')) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(spriteJson),
				});
			}
			if (url.endsWith('.png')) {
				return Promise.resolve({
					ok: true,
					arrayBuffer: () => Promise.resolve(pngData.buffer),
				});
			}
			return Promise.resolve({ ok: false });
		});

		const atlas = await loadSpriteAtlas(makeStyle('https://example.com/sprite'));
		expect(atlas.size).toBe(2);
		expect(atlas.has('airport')).toBe(true);
		expect(atlas.has('park')).toBe(true);

		const airport = atlas.get('airport')!;
		expect(airport.x).toBe(0);
		expect(airport.y).toBe(0);
		expect(airport.width).toBe(32);
		expect(airport.height).toBe(32);
		expect(airport.sheetDataUri).toContain('data:image/png;base64,');
	});

	test('loads sprite from array format with prefix', async () => {
		const spriteJson = {
			icon1: { x: 0, y: 0, width: 16, height: 16, pixelRatio: 2 },
		};
		const pngData = new Uint8Array([0x89]);

		globalThis.fetch = vi.fn().mockImplementation(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve(spriteJson),
				arrayBuffer: () => Promise.resolve(pngData.buffer),
			}),
		);

		const atlas = await loadSpriteAtlas(
			makeStyle([{ id: 'custom', url: 'https://example.com/custom' }]),
		);
		expect(atlas.size).toBe(1);
		expect(atlas.has('custom:icon1')).toBe(true);
	});

	test('default id does not add prefix', async () => {
		const spriteJson = {
			icon1: { x: 0, y: 0, width: 16, height: 16, pixelRatio: 1 },
		};
		const pngData = new Uint8Array([0x89]);

		globalThis.fetch = vi.fn().mockImplementation(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve(spriteJson),
				arrayBuffer: () => Promise.resolve(pngData.buffer),
			}),
		);

		const atlas = await loadSpriteAtlas(
			makeStyle([{ id: 'default', url: 'https://example.com/sprite' }]),
		);
		expect(atlas.has('icon1')).toBe(true);
		expect(atlas.has('default:icon1')).toBe(false);
	});

	test('handles fetch failure gracefully', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

		const atlas = await loadSpriteAtlas(makeStyle('https://example.com/sprite'));
		expect(atlas.size).toBe(0);
	});

	test('handles non-ok response gracefully', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

		const atlas = await loadSpriteAtlas(makeStyle('https://example.com/sprite'));
		expect(atlas.size).toBe(0);
	});

	test('defaults pixelRatio to 1 when missing', async () => {
		const spriteJson = {
			icon: { x: 0, y: 0, width: 16, height: 16 },
		};
		const pngData = new Uint8Array([0x89]);

		globalThis.fetch = vi.fn().mockImplementation(() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.resolve(spriteJson),
				arrayBuffer: () => Promise.resolve(pngData.buffer),
			}),
		);

		const atlas = await loadSpriteAtlas(makeStyle('https://example.com/sprite'));
		expect(atlas.get('icon')!.pixelRatio).toBe(1);
	});
});
