import { describe, expect, test, vi } from 'vitest';
import {
	calculateTileGrid,
	fetchTile,
	getTile,
	isTileInBounds,
	loadSourceTile,
	resolveTileUrl,
	tileDataUri,
	type TileLoader,
} from './tiles.js';

describe('calculateTileGrid', () => {
	test('returns correct zoom level for integer zoom', () => {
		const grid = calculateTileGrid(512, 512, [0, 0], 2);
		expect(grid.zoomLevel).toBe(2);
	});

	test('floors zoom level for fractional zoom', () => {
		const grid = calculateTileGrid(512, 512, [0, 0], 2.7);
		expect(grid.zoomLevel).toBe(2);
	});

	test('clamps zoom level to maxzoom', () => {
		const grid = calculateTileGrid(512, 512, [0, 0], 5, 3);
		expect(grid.zoomLevel).toBe(3);
	});

	test('does not clamp when zoom is below maxzoom', () => {
		const grid = calculateTileGrid(512, 512, [0, 0], 2, 5);
		expect(grid.zoomLevel).toBe(2);
	});

	test('tile size is 512 at integer zoom', () => {
		const grid = calculateTileGrid(512, 512, [0, 0], 2);
		expect(grid.tileSize).toBe(512);
	});

	test('tile size scales for fractional zoom', () => {
		const grid = calculateTileGrid(512, 512, [0, 0], 2.5);
		expect(grid.tileSize).toBeCloseTo(512 * 2 ** 0.5);
	});

	test('returns at least one tile', () => {
		const grid = calculateTileGrid(512, 512, [13.4, 52.5], 10);
		expect(grid.tiles.length).toBeGreaterThanOrEqual(1);
	});

	test('returns more tiles for larger viewport', () => {
		const small = calculateTileGrid(256, 256, [0, 0], 2);
		const large = calculateTileGrid(2048, 2048, [0, 0], 2);
		expect(large.tiles.length).toBeGreaterThan(small.tiles.length);
	});

	test('tiles have integer x and y coordinates', () => {
		const grid = calculateTileGrid(800, 600, [13.4, 52.5], 5);
		for (const tile of grid.tiles) {
			expect(Number.isInteger(tile.x)).toBe(true);
			expect(Number.isInteger(tile.y)).toBe(true);
		}
	});

	test('tile offsets are numeric', () => {
		const grid = calculateTileGrid(800, 600, [13.4, 52.5], 5);
		for (const tile of grid.tiles) {
			expect(typeof tile.offsetX).toBe('number');
			expect(typeof tile.offsetY).toBe('number');
			expect(Number.isFinite(tile.offsetX)).toBe(true);
			expect(Number.isFinite(tile.offsetY)).toBe(true);
		}
	});
});

describe('getTile', () => {
	test('replaces {z}, {x}, {y} in URL and returns buffer', async () => {
		const buffer = new ArrayBuffer(8);
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(buffer, { headers: { 'content-type': 'application/x-protobuf' } }),
		);

		const result = await getTile('https://tiles.example.com/{z}/{x}/{y}.pbf', 5, 10, 12);

		expect(fetch).toHaveBeenCalledWith('https://tiles.example.com/5/10/12.pbf');
		if (result == null) throw new Error('expected result');
		expect(result.contentType).toBe('application/x-protobuf');
		expect(result.buffer.byteLength).toBe(8);
	});

	test('returns null on non-ok response', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 404 }));

		const result = await getTile('https://tiles.example.com/{z}/{x}/{y}.pbf', 5, 10, 12);

		expect(result).toBeNull();
	});

	test('returns null and warns on fetch error', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const result = await getTile('https://tiles.example.com/{z}/{x}/{y}.pbf', 5, 10, 12);

		expect(result).toBeNull();
		expect(warnSpy).toHaveBeenCalledWith(
			'Failed to load tile: https://tiles.example.com/5/10/12.pbf',
			expect.any(Error),
		);

		warnSpy.mockRestore();
	});

	test('defaults content-type to application/octet-stream', async () => {
		const buffer = new ArrayBuffer(4);
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(buffer));

		const result = await getTile('https://example.com/{z}/{x}/{y}', 0, 0, 0);

		if (result == null) throw new Error('expected result');
		expect(result.contentType).toBe('application/octet-stream');
	});
});

describe('fetchTile', () => {
	test.each([404, 204])('reports %i as missing', async (status) => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status }));
		expect(await fetchTile('https://example.com/0/0/0')).toEqual({ status: 'missing' });
	});

	test.each([403, 429, 500, 503])('reports %i as failed', async (status) => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status }));
		expect(await fetchTile('https://example.com/0/0/0')).toEqual({ status: 'failed' });
	});

	test('reports a network error as failed', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		expect(await fetchTile('https://example.com/0/0/0')).toEqual({ status: 'failed' });
		warnSpy.mockRestore();
	});

	test('returns the tile of an ok response', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(new ArrayBuffer(3), { headers: { 'content-type': 'image/webp' } }),
		);
		const result = await fetchTile('https://example.com/0/0/0');
		if (result.status !== 'ok') throw new Error('expected a tile');
		expect(result.tile.contentType).toBe('image/webp');
		expect(result.tile.buffer.byteLength).toBe(3);
	});
});

describe('loadSourceTile', () => {
	const tile = { buffer: new ArrayBuffer(1), contentType: 'image/png' };
	const loader = () => vi.fn<TileLoader>(() => Promise.resolve(tile));

	test('loads the tile from the only URL', async () => {
		const loadTile = loader();
		expect(await loadSourceTile({ tiles: ['a/{z}/{x}/{y}'] }, 3, 2, 5, loadTile)).toBe(tile);
		expect(loadTile).toHaveBeenCalledWith('a/{z}/{x}/{y}', 3, 2, 5);
	});

	test('spreads the tiles over several URLs as MapLibre does', async () => {
		const loadTile = loader();
		const source = { tiles: ['a', 'b', 'c'] };
		await loadSourceTile(source, 3, 0, 0, loadTile);
		await loadSourceTile(source, 3, 1, 0, loadTile);
		await loadSourceTile(source, 3, 1, 1, loadTile);
		await loadSourceTile(source, 3, 2, 2, loadTile);
		expect(loadTile.mock.calls.map(([url]) => url)).toEqual(['a', 'b', 'c', 'b']);
	});

	test('counts y from the south for scheme "tms"', async () => {
		const loadTile = loader();
		await loadSourceTile({ tiles: ['a'], scheme: 'tms' }, 3, 2, 1, loadTile);
		await loadSourceTile({ tiles: ['a'], scheme: 'xyz' }, 3, 2, 1, loadTile);
		expect(loadTile.mock.calls).toEqual([
			['a', 3, 2, 6],
			['a', 3, 2, 1],
		]);
	});

	test('loads nothing below minzoom', async () => {
		const loadTile = loader();
		expect(await loadSourceTile({ tiles: ['a'], minzoom: 4 }, 3, 0, 0, loadTile)).toBeNull();
		expect(await loadSourceTile({ tiles: ['a'], minzoom: 4 }, 4, 0, 0, loadTile)).toBe(tile);
		expect(loadTile).toHaveBeenCalledTimes(1);
	});

	test('loads nothing outside bounds', async () => {
		const loadTile = loader();
		// Europe, roughly: at zoom 2, only the tiles x = 1..2, y = 0..1.
		const source = { tiles: ['a'], bounds: [-10, 35, 30, 70] };
		expect(await loadSourceTile(source, 2, 0, 1, loadTile)).toBeNull();
		expect(await loadSourceTile(source, 2, 2, 1, loadTile)).toBe(tile);
		expect(loadTile).toHaveBeenCalledTimes(1);
	});

	test('loads nothing from a source without URLs', async () => {
		const loadTile = loader();
		expect(await loadSourceTile({ tiles: [] }, 3, 0, 0, loadTile)).toBeNull();
		expect(loadTile).not.toHaveBeenCalled();
	});
});

describe('isTileInBounds', () => {
	test('accepts every tile without valid bounds', () => {
		expect(isTileInBounds(undefined, 5, 7, 9)).toBe(true);
		expect(isTileInBounds([1, 2, 3], 5, 7, 9)).toBe(true);
		expect(isTileInBounds([0, 0, 'x', 0], 5, 7, 9)).toBe(true);
	});

	test('accepts every tile for bounds covering the world, poles included', () => {
		for (const [x, y] of [
			[0, 0],
			[3, 3],
			[1, 2],
		]) {
			expect(isTileInBounds([-180, -90, 180, 90], 2, x!, y!)).toBe(true);
		}
	});

	test('accepts the tiles overlapping the bounds only', () => {
		const bounds = [-10, 35, 30, 70];
		const inside: string[] = [];
		for (let x = 0; x < 4; x++) {
			for (let y = 0; y < 4; y++)
				if (isTileInBounds(bounds, 2, x, y)) inside.push(`${String(x)}/${String(y)}`);
		}
		expect(inside).toEqual(['1/0', '1/1', '2/0', '2/1']);
	});

	test('accepts a tile touching the bounds from inside, not from outside', () => {
		// The bounds end exactly at the prime meridian, the border of tiles 0 and 1 at zoom 1.
		expect(isTileInBounds([-90, -10, 0, 10], 1, 0, 0)).toBe(true);
		expect(isTileInBounds([-90, -10, 0, 10], 1, 1, 0)).toBe(false);
	});
});

describe('resolveTileUrl', () => {
	test('fills in z, x and y', () => {
		expect(resolveTileUrl('https://a/{z}/{x}/{y}.png', 3, 4, 5)).toBe('https://a/3/4/5.png');
	});
});

describe('tileDataUri', () => {
	test('encodes the tile with its content type', () => {
		const tile = { buffer: new Uint8Array([1, 2, 3]).buffer, contentType: 'image/png' };
		expect(tileDataUri(tile)).toBe('data:image/png;base64,AQID');
	});

	test('returns the same string for the same tile', () => {
		const tile = { buffer: new Uint8Array(1000).buffer, contentType: 'image/png' };
		expect(tileDataUri(tile)).toBe(tileDataUri(tile));
	});
});
