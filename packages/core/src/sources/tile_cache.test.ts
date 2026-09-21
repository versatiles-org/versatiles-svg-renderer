import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { TileCache } from './tile_cache.js';
import { tileDataUri } from './tiles.js';

const URL_TEMPLATE = 'https://example.com/{z}/{x}/{y}';

/** Answers every request with `size` bytes of `type`, or with `status`, after a tick. */
function mockFetch(
	answer: (url: string) => { status?: number; size?: number; type?: string } | Error = () => ({}),
): Mock {
	const fetchMock = vi.fn(async (url: string) => {
		await new Promise((resolve) => setTimeout(resolve, 1));
		const a = answer(url);
		if (a instanceof Error) throw a;
		const status = a.status ?? 200;
		if (status === 204) return new Response(null, { status });
		return new Response(status === 200 ? new Uint8Array(a.size ?? 100) : null, {
			status,
			headers: { 'content-type': a.type ?? 'application/x-protobuf' },
		});
	});
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

describe('TileCache', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	test('fetches a tile once and returns the same object on a hit', async () => {
		const fetchMock = mockFetch();
		const cache = new TileCache(1e6);
		const first = await cache.load(URL_TEMPLATE, 1, 2, 3);
		const second = await cache.load(URL_TEMPLATE, 1, 2, 3);
		expect(first).not.toBeNull();
		expect(second).toBe(first);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith('https://example.com/1/2/3');
	});

	test('keys by the resolved URL', async () => {
		const fetchMock = mockFetch();
		const cache = new TileCache(1e6);
		await cache.load(URL_TEMPLATE, 1, 2, 3);
		await cache.load(URL_TEMPLATE, 1, 3, 2);
		await cache.load('https://example.com/1/2/3', 9, 9, 9);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('shares the fetch of a tile that is still loading', async () => {
		const fetchMock = mockFetch();
		const cache = new TileCache(1e6);
		const [a, b] = await Promise.all([
			cache.load(URL_TEMPLATE, 1, 0, 0),
			cache.load(URL_TEMPLATE, 1, 0, 0),
		]);
		expect(a).toBe(b);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test('with size 0, keeps nothing but still shares a running fetch', async () => {
		const fetchMock = mockFetch();
		const cache = new TileCache(0);
		await Promise.all([cache.load(URL_TEMPLATE, 1, 0, 0), cache.load(URL_TEMPLATE, 1, 0, 0)]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(cache.count).toBe(0);
		await cache.load(URL_TEMPLATE, 1, 0, 0);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test.each([404, 204])('remembers a tile answered with %i as missing', async (status) => {
		const fetchMock = mockFetch(() => ({ status }));
		const cache = new TileCache(1e6);
		expect(await cache.load(URL_TEMPLATE, 1, 0, 0)).toBeNull();
		expect(await cache.load(URL_TEMPLATE, 1, 0, 0)).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(cache.bytes).toBe(64);
	});

	test.each([
		['a server error', { status: 500 }],
		['a rate limit', { status: 429 }],
		['a forbidden tile', { status: 403 }],
		['a network error', new Error('offline')],
	])('does not remember %s', async (_name, answer) => {
		const fetchMock = mockFetch(() => answer);
		const cache = new TileCache(1e6);
		expect(await cache.load(URL_TEMPLATE, 1, 0, 0)).toBeNull();
		expect(cache.count).toBe(0);
		await cache.load(URL_TEMPLATE, 1, 0, 0);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('drops the least recently used tiles beyond its size', async () => {
		const fetchMock = mockFetch(() => ({ size: 100 }));
		const cache = new TileCache(250);
		await cache.load(URL_TEMPLATE, 1, 0, 0);
		await cache.load(URL_TEMPLATE, 1, 1, 0);
		await cache.load(URL_TEMPLATE, 1, 0, 0); // now the most recently used
		await cache.load(URL_TEMPLATE, 1, 2, 0); // evicts 1/1/0
		expect(cache.bytes).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(3);

		await cache.load(URL_TEMPLATE, 1, 0, 0);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		await cache.load(URL_TEMPLATE, 1, 1, 0);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	test('does not keep a tile larger than the whole cache, nor evict others for it', async () => {
		mockFetch((url) => ({ size: url.endsWith('/big') ? 1000 : 100 }));
		const cache = new TileCache(250);
		await cache.load(URL_TEMPLATE, 1, 0, 0);
		expect(await cache.load('https://example.com/big', 0, 0, 0)).not.toBeNull();
		expect(cache.count).toBe(1);
		expect(cache.bytes).toBe(100);
	});

	test('counts raster tiles with their base64 copy', async () => {
		mockFetch(() => ({ size: 300, type: 'image/png' }));
		const cache = new TileCache(1e6);
		await cache.load(URL_TEMPLATE, 1, 0, 0);
		expect(cache.bytes).toBe(300 + 400);
	});

	test('clear drops everything, including fetches still running', async () => {
		const fetchMock = mockFetch();
		const cache = new TileCache(1e6);
		await cache.load(URL_TEMPLATE, 1, 0, 0);
		const running = cache.load(URL_TEMPLATE, 1, 1, 0);
		cache.clear();
		await running;
		expect(cache.count).toBe(0);
		expect(cache.bytes).toBe(0);
		await cache.load(URL_TEMPLATE, 1, 0, 0);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	test('rejects a negative or non-numeric size', () => {
		expect(() => new TileCache(-1)).toThrow('tileCacheSize');
		expect(() => new TileCache(NaN)).toThrow('tileCacheSize');
	});

	test('a cached raster tile is base64-encoded once', async () => {
		mockFetch(() => ({ type: 'image/png' }));
		const cache = new TileCache(1e6);
		const tile = (await cache.load(URL_TEMPLATE, 1, 0, 0))!;
		const again = (await cache.load(URL_TEMPLATE, 1, 0, 0))!;
		expect(tileDataUri(again)).toBe(tileDataUri(tile));
		expect(tileDataUri(tile)).toMatch(/^data:image\/png;base64,/);
	});
});
