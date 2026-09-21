import { describe, expect, test, vi } from 'vitest';
import { calculateTileGrid, getTile } from './tiles.js';

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
