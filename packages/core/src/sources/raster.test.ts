import { afterEach, describe, expect, test, vi } from 'vitest';
import { getRasterTiles } from './raster.js';
import type { RenderJob, Renderer } from '../renderer/svg.js';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

afterEach(() => {
	vi.restoreAllMocks();
});

function makeJob(sources: Record<string, unknown>): RenderJob {
	return {
		renderer: { width: 512, height: 512 } as Renderer,
		view: { zoom: 0, center: [0, 0] },
		style: { sources, version: 8, layers: [] } as unknown as StyleSpecification,
	};
}

function mockFetchPng(): void {
	vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
		const pngBytes = new Uint8Array([137, 80, 78, 71]);
		return Promise.resolve(
			new Response(pngBytes.buffer, { headers: { 'content-type': 'image/png' } }),
		);
	});
}

describe('getRasterTiles', () => {
	test('throws on missing source', async () => {
		const job = makeJob({});
		await expect(getRasterTiles(job, 'missing')).rejects.toThrow('Invalid raster source "missing"');
	});

	test('throws on non-raster source', async () => {
		const job = makeJob({ src: { type: 'vector', tiles: ['https://a/{z}/{x}/{y}.pbf'] } });
		await expect(getRasterTiles(job, 'src')).rejects.toThrow('Invalid raster source "src"');
	});

	test('throws on raster source without tiles', async () => {
		const job = makeJob({ src: { type: 'raster' } });
		await expect(getRasterTiles(job, 'src')).rejects.toThrow('Invalid raster source "src"');
	});

	test('fetches tiles and returns data URIs', async () => {
		mockFetchPng();

		const job = makeJob({ raster: { type: 'raster', tiles: ['https://a/{z}/{x}/{y}.png'] } });
		const tiles = await getRasterTiles(job, 'raster');

		expect(tiles.length).toBeGreaterThanOrEqual(1);
		for (const tile of tiles) {
			expect(tile.dataUri).toMatch(/^data:image\/png;base64,/);
			expect(typeof tile.x).toBe('number');
			expect(typeof tile.y).toBe('number');
			expect(tile.width).toBeGreaterThan(0);
			expect(tile.height).toBeGreaterThan(0);
		}
	});

	test('filters out failed tile fetches', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
			return Promise.resolve(new Response(null, { status: 404 }));
		});

		const job = makeJob({ raster: { type: 'raster', tiles: ['https://a/{z}/{x}/{y}.png'] } });
		const tiles = await getRasterTiles(job, 'raster');

		expect(tiles).toHaveLength(0);
	});

	test('respects maxzoom', async () => {
		mockFetchPng();

		const job: RenderJob = {
			renderer: { width: 512, height: 512 } as Renderer,
			view: { zoom: 10, center: [13.4, 52.5] },
			style: {
				sources: { raster: { type: 'raster', tiles: ['https://a/{z}/{x}/{y}.png'], maxzoom: 3 } },
				version: 8,
				layers: [],
			} as unknown as StyleSpecification,
		};

		await getRasterTiles(job, 'raster');

		const fetchSpy = vi.mocked(fetch);
		// All fetched URLs should use zoom level 3 (maxzoom), not 10
		for (const call of fetchSpy.mock.calls) {
			const url = call[0] as string;
			expect(url).toMatch(/^https:\/\/a\/3\//);
		}
	});
});
