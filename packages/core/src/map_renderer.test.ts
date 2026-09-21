import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { SVGMapRenderer, viewSize } from './map_renderer.js';
import { renderToSVG } from './render_svg.js';

const SPRITE_URL = 'https://example.com/sprite';
const TILE_URL = 'https://example.com/tiles/{z}/{x}/{y}.png';

/** A style whose raster layer reads a zoom-dependent paint value after awaiting its tiles. */
function makeStyle(): StyleSpecification {
	return {
		version: 8,
		sprite: SPRITE_URL,
		sources: {
			raster: { type: 'raster', tiles: [TILE_URL], tileSize: 512 },
			points: {
				type: 'geojson',
				data: {
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { icon: 'dot' },
				},
			},
		},
		layers: [
			{
				id: 'background',
				type: 'background',
				paint: { 'background-color': ['interpolate', ['linear'], ['zoom'], 0, '#000', 20, '#fff'] },
			},
			{
				id: 'raster',
				type: 'raster',
				source: 'raster',
				paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.1, 20, 0.9] },
			},
			{
				id: 'icons',
				type: 'symbol',
				source: 'points',
				layout: { 'icon-image': '{icon}' },
			},
		],
	};
}

function response(body: string | Uint8Array<ArrayBuffer>, type: string): Response {
	const buffer = typeof body === 'string' ? new TextEncoder().encode(body) : body;
	return new Response(buffer, { headers: { 'content-type': type } });
}

/** Answers tile and sprite requests after a short delay, so concurrent renders interleave. */
function mockFetch(options: { spriteFails?: boolean } = {}): Mock {
	const fetchMock = vi.fn(async (url: string) => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		if (url.startsWith(SPRITE_URL)) {
			if (options.spriteFails) return new Response(null, { status: 500 });
			return url.endsWith('.json')
				? response(JSON.stringify({ dot: { x: 0, y: 0, width: 4, height: 4 } }), 'application/json')
				: response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
		}
		return response(new Uint8Array([1, 2, 3, 4]), 'image/png');
	});
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

function spriteRequests(fetchMock: Mock): number {
	return fetchMock.mock.calls.filter(([url]) => String(url).startsWith(SPRITE_URL)).length;
}

function tileRequests(fetchMock: Mock): number {
	return fetchMock.mock.calls.filter(([url]) =>
		String(url).startsWith('https://example.com/tiles/'),
	).length;
}

describe('SVGMapRenderer', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mockFetch();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test('renders the same SVG as renderToSVG', async () => {
		const view = { width: 300, height: 200, lon: 10, lat: 20, zoom: 3 };
		const style = makeStyle();
		const map = new SVGMapRenderer({ style, renderLabels: true });
		const expected = await renderToSVG({ style, renderLabels: true, ...view });
		expect(await map.renderSVG(view)).toBe(expected);
	});

	test('applies the view defaults of renderToSVG', async () => {
		const style = makeStyle();
		const map = new SVGMapRenderer({ style });
		expect(await map.renderSVG()).toBe(await renderToSVG({ style }));
	});

	test('fetches the sprite only once for several renders', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true });
		await map.renderSVG({ zoom: 2 });
		await map.renderSVG({ zoom: 3 });
		// @2x JSON and PNG, once.
		expect(spriteRequests(fetchMock)).toBe(2);
	});

	test('shares one sprite fetch between concurrent first renders', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true });
		await Promise.all([map.renderSVG({ zoom: 2 }), map.renderSVG({ zoom: 3 })]);
		expect(spriteRequests(fetchMock)).toBe(2);
	});

	test('draws the cached sprite in later renders', async () => {
		const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true });
		await map.renderSVG();
		expect(await map.renderSVG()).toContain('data:image/png;base64,');
	});

	test('does not fetch the sprite without labels', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeStyle() });
		await map.renderSVG();
		expect(spriteRequests(fetchMock)).toBe(0);
	});

	test('fetches a sprite that failed to load again', async () => {
		let fetchMock = mockFetch({ spriteFails: true });
		const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true });
		await map.renderSVG();
		// @2x, then 1x: JSON and PNG each.
		expect(spriteRequests(fetchMock)).toBe(4);

		fetchMock = mockFetch();
		await map.renderSVG();
		expect(spriteRequests(fetchMock)).toBe(2);
		await map.renderSVG();
		expect(spriteRequests(fetchMock)).toBe(2);
	});

	test('clearCache makes the next render fetch the sprite again', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true });
		await map.renderSVG();
		map.clearCache();
		await map.renderSVG();
		expect(spriteRequests(fetchMock)).toBe(4);
	});

	test('fetches each tile only once for overlapping views', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeStyle() });
		await map.renderSVG({ zoom: 3, width: 256, height: 256 });
		const first = tileRequests(fetchMock);
		expect(first).toBeGreaterThan(0);
		await map.renderSVG({ zoom: 3, width: 256, height: 256, lon: 1 });
		expect(tileRequests(fetchMock)).toBe(first);
	});

	test('shares tile fetches between concurrent renders', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeStyle() });
		await Promise.all([map.renderSVG({ zoom: 3 }), map.renderSVG({ zoom: 3 })]);
		const concurrent = tileRequests(fetchMock);

		const single = mockFetch();
		await new SVGMapRenderer({ style: makeStyle() }).renderSVG({ zoom: 3 });
		expect(concurrent).toBe(tileRequests(single));
	});

	test('with tileCacheSize 0, fetches the tiles for every render', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeStyle(), tileCacheSize: 0 });
		await map.renderSVG({ zoom: 3 });
		const first = tileRequests(fetchMock);
		await map.renderSVG({ zoom: 3 });
		expect(tileRequests(fetchMock)).toBe(2 * first);
	});

	test('clearCache makes the next render fetch the tiles again', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeStyle() });
		await map.renderSVG({ zoom: 3 });
		const first = tileRequests(fetchMock);
		map.clearCache();
		await map.renderSVG({ zoom: 3 });
		expect(tileRequests(fetchMock)).toBe(2 * first);
	});

	test('rejects a negative tileCacheSize', () => {
		expect(() => new SVGMapRenderer({ style: makeStyle(), tileCacheSize: -1 })).toThrow(
			'tileCacheSize',
		);
	});

	test('concurrent renders at different zooms match sequential ones', async () => {
		const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true });
		const zooms = [1, 5, 9, 13];
		const sequential: string[] = [];
		for (const zoom of zooms)
			sequential.push(await map.renderSVG({ zoom, width: 256, height: 256 }));
		const concurrent = await Promise.all(
			zooms.map((zoom) => map.renderSVG({ zoom, width: 256, height: 256 })),
		);
		expect(concurrent).toEqual(sequential);
		// The zoom-dependent values really differ, so a mix-up would show.
		expect(new Set(sequential).size).toBe(zooms.length);
	});

	test('rejects a non-positive size', async () => {
		const map = new SVGMapRenderer({ style: makeStyle() });
		await expect(map.renderSVG({ width: 0 })).rejects.toThrow('width must be positive');
		await expect(map.renderSVG({ height: -1 })).rejects.toThrow('height must be positive');
	});
});

describe('viewSize', () => {
	test('defaults to 1024 × 1024', () => {
		expect(viewSize({})).toEqual({ width: 1024, height: 1024 });
	});

	test('keeps a given size', () => {
		expect(viewSize({ width: 10, height: 20 })).toEqual({ width: 10, height: 20 });
	});
});
