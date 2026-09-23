import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from 'geojson';
import { SVGMapRenderer, viewSize } from './map_renderer.js';
import { renderToSVG } from './render_svg.js';

const SPRITE_URL = 'https://example.com/sprite';
const TILE_URL = 'https://example.com/tiles/{z}/{x}/{y}.png';
const TILEJSON_URL = 'https://example.com/tiles.json';
const GEOJSON_URL = 'https://example.com/points.geojson';
const POINT: Feature = {
	type: 'Feature',
	geometry: { type: 'Point', coordinates: [0, 0] },
	properties: { icon: 'dot' },
};

/** A style whose raster layer reads a zoom-dependent paint value after awaiting its tiles. */
function makeStyle(): StyleSpecification {
	return {
		version: 8,
		sprite: SPRITE_URL,
		sources: {
			raster: { type: 'raster', tiles: [TILE_URL], tileSize: 512 },
			points: {
				type: 'geojson',
				data: POINT,
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
/** A fetch that answers tile and sprite requests after a short delay. */
function fakeFetch(
	options: { spriteFails?: boolean; tileJSONFails?: boolean; tileStatus?: number } = {},
): Mock<(url: string) => Promise<Response>> {
	return vi.fn(async (url: string) => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		if (url === GEOJSON_URL) return response(JSON.stringify(POINT), 'application/geo+json');
		if (url === TILEJSON_URL) {
			if (options.tileJSONFails) return new Response(null, { status: 500 });
			// A relative tile URL, resolved against the TileJSON URL to TILE_URL.
			return response(JSON.stringify({ tiles: ['tiles/{z}/{x}/{y}.png'] }), 'application/json');
		}
		if (url.startsWith(SPRITE_URL)) {
			if (options.spriteFails) return new Response(null, { status: 500 });
			return url.endsWith('.json')
				? response(JSON.stringify({ dot: { x: 0, y: 0, width: 4, height: 4 } }), 'application/json')
				: response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
		}
		if (options.tileStatus) return new Response(null, { status: options.tileStatus });
		return response(new Uint8Array([1, 2, 3, 4]), 'image/png');
	});
}

/** Installs a fake fetch as the global `fetch`, so that concurrent renders interleave. */
function mockFetch(options: { spriteFails?: boolean; tileJSONFails?: boolean } = {}): Mock {
	const fetchMock = fakeFetch(options);
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

/** A global `fetch` that fails the test if anything uses it. */
function forbidGlobalFetch(): void {
	globalThis.fetch = () => {
		throw new Error('the global fetch was used');
	};
}

function spriteRequests(fetchMock: Mock): number {
	return fetchMock.mock.calls.filter(([url]) => String(url).startsWith(SPRITE_URL)).length;
}

function tileJSONRequests(fetchMock: Mock): number {
	return fetchMock.mock.calls.filter(([url]) => url === TILEJSON_URL).length;
}

/** {@link makeStyle}, with the raster source given by a TileJSON document instead of `tiles`. */
function makeTileJSONStyle(): StyleSpecification {
	const style = makeStyle();
	style.sources.raster = { type: 'raster', url: TILEJSON_URL, tileSize: 512 };
	return style;
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

	test('renders a TileJSON source like one that lists its tiles', async () => {
		const view = { zoom: 3, width: 256, height: 256 };
		const expected = await new SVGMapRenderer({ style: makeStyle() }).renderSVG(view);
		const fetchMock = mockFetch();
		const svg = await new SVGMapRenderer({ style: makeTileJSONStyle() }).renderSVG(view);
		expect(tileRequests(fetchMock)).toBeGreaterThan(0);
		expect(svg).toBe(expected);
	});

	test('fetches a TileJSON document only once, also for concurrent renders', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeTileJSONStyle() });
		await Promise.all([map.renderSVG({ zoom: 3 }), map.renderSVG({ zoom: 3 })]);
		await map.renderSVG({ zoom: 4 });
		expect(tileJSONRequests(fetchMock)).toBe(1);
	});

	test('fetches a TileJSON document that failed to load again', async () => {
		let fetchMock = mockFetch({ tileJSONFails: true });
		const map = new SVGMapRenderer({ style: makeTileJSONStyle(), onWarning: vi.fn() });
		await map.renderSVG({ zoom: 3 });
		expect(tileJSONRequests(fetchMock)).toBe(1);
		expect(tileRequests(fetchMock)).toBe(0);

		fetchMock = mockFetch();
		await map.renderSVG({ zoom: 3 });
		await map.renderSVG({ zoom: 3 });
		expect(tileJSONRequests(fetchMock)).toBe(1);
		expect(tileRequests(fetchMock)).toBeGreaterThan(0);
	});

	test('clearCache makes the next render fetch the TileJSON document again', async () => {
		const fetchMock = mockFetch();
		const map = new SVGMapRenderer({ style: makeTileJSONStyle() });
		await map.renderSVG();
		map.clearCache();
		await map.renderSVG();
		expect(tileJSONRequests(fetchMock)).toBe(2);
	});

	test('renders GeoJSON data given as a URL like inline data, fetching it once', async () => {
		const expected = await new SVGMapRenderer({
			style: makeStyle(),
			renderLabels: true,
		}).renderSVG();
		const fetchMock = mockFetch();
		const style = makeStyle();
		style.sources.points = { type: 'geojson', data: GEOJSON_URL };
		const map = new SVGMapRenderer({ style, renderLabels: true });
		expect(await map.renderSVG()).toBe(expected);
		await map.renderSVG();
		expect(fetchMock.mock.calls.filter(([url]) => url === GEOJSON_URL)).toHaveLength(1);
	});

	test('reports unsupported parts of the style once, across renders', async () => {
		const style = makeStyle();
		style.layers.push({ id: 'heat', type: 'heatmap', source: 'points' });
		const onWarning = vi.fn();
		const map = new SVGMapRenderer({ style, onWarning });
		await map.renderSVG();
		await map.renderSVG();
		expect(onWarning.mock.calls).toEqual([
			['Layers of type "heatmap" are not supported and are not drawn: "heat".'],
		]);
	});

	test('reports a TileJSON document that could not be loaded, once', async () => {
		mockFetch({ tileJSONFails: true });
		const onWarning = vi.fn();
		const map = new SVGMapRenderer({ style: makeTileJSONStyle(), onWarning });
		await map.renderSVG({ zoom: 3 });
		await map.renderSVG({ zoom: 3 });
		expect(onWarning.mock.calls).toEqual([
			[
				`Source "raster": the TileJSON document could not be loaded from ${TILEJSON_URL}; the source is empty.`,
			],
		]);
	});

	test('reports warnings with console.warn by default', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
		const style = makeStyle();
		style.terrain = { source: 'raster' };
		new SVGMapRenderer({ style });
		expect(warn).toHaveBeenCalledWith(
			'The style property "terrain" is not supported and is ignored.',
		);
		warn.mockRestore();
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

	describe('fetch option', () => {
		test('loads tiles and sprites through the given function only', async () => {
			forbidGlobalFetch();
			const fetchFn = fakeFetch();
			const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true, fetch: fetchFn });
			await map.renderSVG({ zoom: 3 });
			expect(tileRequests(fetchFn)).toBeGreaterThan(0);
			expect(spriteRequests(fetchFn)).toBe(2);
		});

		test('without it, uses the global fetch as it is at render time', async () => {
			const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true });
			const fetchMock = mockFetch();
			await map.renderSVG({ zoom: 3 });
			expect(tileRequests(fetchMock)).toBeGreaterThan(0);
		});

		test('calls it as a plain function, as the browser needs for window.fetch', async () => {
			const inner = fakeFetch();
			// Like window.fetch, which throws "Illegal invocation" when called on another object.
			const fetchFn = function (this: unknown, url: string): Promise<Response> {
				if (this !== undefined) throw new TypeError('Illegal invocation');
				return inner(url);
			};
			const map = new SVGMapRenderer({ style: makeStyle(), renderLabels: true, fetch: fetchFn });
			await expect(map.renderSVG({ zoom: 3 })).resolves.toMatch(/^<svg/);
			expect(tileRequests(inner)).toBeGreaterThan(0);
		});

		test('remembers a tile it answers with 404', async () => {
			const fetchFn = fakeFetch({ tileStatus: 404 });
			const map = new SVGMapRenderer({ style: makeStyle(), fetch: fetchFn });
			await map.renderSVG({ zoom: 3 });
			const first = tileRequests(fetchFn);
			await map.renderSVG({ zoom: 3 });
			expect(tileRequests(fetchFn)).toBe(first);
		});

		test('tries a tile again that it answered with 500 or a rejection', async () => {
			for (const fetchFn of [
				fakeFetch({ tileStatus: 500 }),
				vi.fn((url: string) =>
					url.startsWith(SPRITE_URL) ? fakeFetch()(url) : Promise.reject(new Error('offline')),
				),
			]) {
				vi.spyOn(console, 'warn').mockImplementation(() => undefined);
				const map = new SVGMapRenderer({ style: makeStyle(), fetch: fetchFn });
				await map.renderSVG({ zoom: 3 });
				const first = tileRequests(fetchFn);
				await map.renderSVG({ zoom: 3 });
				expect(tileRequests(fetchFn)).toBe(2 * first);
			}
			vi.restoreAllMocks();
		});

		test('is passed on by renderToSVG', async () => {
			forbidGlobalFetch();
			const fetchFn = fakeFetch();
			await renderToSVG({ style: makeStyle(), renderLabels: true, zoom: 3, fetch: fetchFn });
			expect(tileRequests(fetchFn)).toBeGreaterThan(0);
			expect(spriteRequests(fetchFn)).toBe(2);
		});
	});

	test('rejects a non-positive size', async () => {
		const map = new SVGMapRenderer({ style: makeStyle() });
		await expect(map.renderSVG({ width: 0 })).rejects.toThrow('width must be positive');
		await expect(map.renderSVG({ height: -1 })).rejects.toThrow('height must be positive');
	});
});

describe('SVGMapRenderer.project', () => {
	const flat: StyleSpecification = { version: 8, sources: {}, layers: [] };
	const globe: StyleSpecification = { ...flat, projection: { type: 'globe' } };
	const view = { width: 400, height: 300, lon: 10, lat: 20, zoom: 3 };

	test('puts the center of the view in the middle of the image', () => {
		for (const style of [flat, globe]) {
			const [x, y] = new SVGMapRenderer({ style }).project(view, [10, 20])!;
			expect(x).toBeCloseTo(200, 6);
			expect(y).toBeCloseTo(150, 6);
		}
	});

	test('moves a degree of longitude by the world size at the zoom level, in mercator', () => {
		const [x] = new SVGMapRenderer({ style: flat }).project(view, [11, 20])!;
		expect(x - 200).toBeCloseTo((512 * 2 ** 3) / 360, 6);
	});

	test('hides a point on the far side of the globe', () => {
		const map = new SVGMapRenderer({ style: globe });
		const whole = { width: 400, height: 400, lon: 0, lat: 0, zoom: 1 };
		expect(map.project(whole, [180, 0])).toBeUndefined();
		expect(map.project(whole, [30, 10])).toBeDefined();
		// Mercator has no far side.
		expect(new SVGMapRenderer({ style: flat }).project(whole, [180, 0])).toBeDefined();
	});

	test('agrees with where the renderer draws a point', async () => {
		const point: [number, number] = [11.3, 21.2];
		for (const projection of [undefined, { type: 'globe' as const }]) {
			const style: StyleSpecification = {
				version: 8,
				...(projection ? { projection } : {}),
				sources: {
					dot: {
						type: 'geojson',
						data: { type: 'Point', coordinates: point },
					},
				},
				layers: [{ id: 'dot', type: 'circle', source: 'dot', paint: { 'circle-radius': 3 } }],
			};
			const map = new SVGMapRenderer({ style });
			const svg = await map.renderSVG(view);
			// The layer's circle, not the globe's clip circle.
			const match = /<g id="dot">\s*<circle cx="([\d.-]+)" cy="([\d.-]+)"/.exec(svg);
			if (!match) throw new Error('no circle in the SVG');
			const [x, y] = map.project(view, point)!;
			expect(Number(match[1])).toBeCloseTo(x, 1);
			expect(Number(match[2])).toBeCloseTo(y, 1);
		}
	});

	test('puts the poles at the edge of the map, where the mercator map ends', () => {
		const edge = 85.05112877980659;
		for (const [style, v] of [
			[flat, view],
			// On the globe, a view near the pole, so the pole is on the visible side.
			[globe, { width: 400, height: 400, lon: 0, lat: 70, zoom: 1 }],
		] as const) {
			const map = new SVGMapRenderer({ style });
			for (const sign of [1, -1]) {
				if (style === globe && sign === -1) continue; // the south pole is hidden from there
				const pole = map.project(v, [0, 90 * sign])!;
				expect(pole.every(Number.isFinite)).toBe(true);
				expect(pole).toEqual(map.project(v, [0, edge * sign]));
			}
		}
	});

	test('rejects a non-positive size, like renderSVG', () => {
		expect(() => new SVGMapRenderer({ style: flat }).project({ width: 0 }, [0, 0])).toThrow(
			'width must be positive',
		);
	});
});

describe('SVGMapRenderer.unproject', () => {
	const flat: StyleSpecification = { version: 8, sources: {}, layers: [] };
	const globe: StyleSpecification = { ...flat, projection: { type: 'globe' } };

	test.each([
		['mercator', flat, { width: 400, height: 300, lon: 10, lat: 20, zoom: 3 }],
		['the globe', globe, { width: 400, height: 300, lon: 10, lat: 20, zoom: 3 }],
		[
			'the transition to mercator',
			globe,
			{ width: 400, height: 300, lon: 139.7, lat: 35.7, zoom: 11.5 },
		],
	])('undoes project on %s', (_name, style, view) => {
		const map = new SVGMapRenderer({ style });
		const spread = view.zoom > 10 ? 0.01 : 5;
		for (const [dLon, dLat] of [
			[0, 0],
			[1, 0.5],
			[-0.7, -1],
		] as const) {
			const lonLat: [number, number] = [view.lon + dLon * spread, view.lat + dLat * spread];
			const [lon, lat] = map.unproject(view, map.project(view, lonLat)!)!;
			expect(lon).toBeCloseTo(lonLat[0], 6);
			expect(lat).toBeCloseTo(lonLat[1], 6);
		}
	});

	test('gives the center of the view for the middle of the image', () => {
		const view = { width: 400, height: 300, lon: 10, lat: 20, zoom: 3 };
		for (const style of [flat, globe]) {
			const [lon, lat] = new SVGMapRenderer({ style }).unproject(view, [200, 150])!;
			expect(lon).toBeCloseTo(10, 6);
			expect(lat).toBeCloseTo(20, 6);
		}
	});

	test('gives nothing next to the globe', () => {
		const map = new SVGMapRenderer({ style: globe });
		expect(map.unproject({ width: 400, height: 400, zoom: 0 }, [2, 2])).toBeUndefined();
	});

	test('gives nothing for a position that is not a finite number', () => {
		const view = { width: 400, height: 300, lon: 10, lat: 20, zoom: 3 };
		for (const style of [flat, globe]) {
			const map = new SVGMapRenderer({ style });
			for (const xy of [
				[NaN, 0],
				[0, NaN],
				[Infinity, 0],
				[0, -Infinity],
			] as [number, number][]) {
				expect(map.unproject(view, xy)).toBeUndefined();
				expect(map.project(view, xy)).toBeUndefined();
			}
		}
	});

	test('rejects a non-positive size, like project', () => {
		expect(() => new SVGMapRenderer({ style: flat }).unproject({ height: 0 }, [0, 0])).toThrow(
			'height must be positive',
		);
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
