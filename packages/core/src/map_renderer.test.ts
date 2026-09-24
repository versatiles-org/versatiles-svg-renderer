import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from 'geojson';
import { SVGMapRenderer, viewSize } from './map_renderer.js';
import { renderToSVG } from './render_svg.js';
import { glyphFile } from './sources/__fixtures__/glyphs.js';

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

	test("uses the style's center and zoom where the view does not set them", async () => {
		const style: StyleSpecification = { ...makeStyle(), center: [10, 20], zoom: 3 };
		const map = new SVGMapRenderer({ style });
		const plain = new SVGMapRenderer({ style: makeStyle() });
		expect(await map.renderSVG()).not.toBe(await plain.renderSVG());
		expect(await map.renderSVG()).toBe(await plain.renderSVG({ lon: 10, lat: 20, zoom: 3 }));
		expect(await map.renderSVG({ lat: 5 })).toBe(
			await plain.renderSVG({ lon: 10, lat: 5, zoom: 3 }),
		);
		expect(await map.renderSVG({ lon: 1, lat: 2, zoom: 4 })).toBe(
			await plain.renderSVG({ lon: 1, lat: 2, zoom: 4 }),
		);
	});

	test('projects and unprojects with the bearing of the view, or of the style', () => {
		const style: StyleSpecification = { ...makeStyle(), bearing: 90 };
		const map = new SVGMapRenderer({ style });
		const view = { width: 100, height: 100, lon: 0, lat: 0, zoom: 10 };
		// East is up with the style's bearing of 90°, and right with a bearing of 0.
		const [x, y] = map.project(view, [0.01, 0])!;
		expect(x).toBeCloseTo(50);
		expect(y).toBeLessThan(50);
		const [x0, y0] = map.project({ ...view, bearing: 0 }, [0.01, 0])!;
		expect(x0).toBeGreaterThan(50);
		expect(y0).toBeCloseTo(50);
		const [lon, lat] = map.unproject(view, [x, y])!;
		expect(lon).toBeCloseTo(0.01, 6);
		expect(lat).toBeCloseTo(0, 6);
	});

	test('puts the center in the middle of the area inside the padding', () => {
		const map = new SVGMapRenderer({ style: makeStyle() });
		const view = { width: 100, height: 100, lon: 10, lat: 20, zoom: 5 };
		expect(map.project({ ...view, padding: 20 }, [10, 20])).toEqual([50, 50]);
		expect(map.project({ ...view, padding: { left: 40 } }, [10, 20])).toEqual([70, 50]);
		const [lon, lat] = map.unproject({ ...view, padding: { left: 40 } }, [70, 50])!;
		expect(lon).toBeCloseTo(10, 6);
		expect(lat).toBeCloseTo(20, 6);
	});

	test("projects with the style's center and zoom as defaults", () => {
		const map = new SVGMapRenderer({ style: { ...makeStyle(), center: [10, 20], zoom: 3 } });
		expect(map.project({ width: 100, height: 100 }, [10, 20])).toEqual([50, 50]);
		expect(map.unproject({ width: 100, height: 100 }, [50, 50])).toEqual([
			10,
			expect.closeTo(20, 9),
		]);
	});

	test("ignores a style's center or zoom that is not a number", async () => {
		const style = {
			...makeStyle(),
			center: ['x', null],
			zoom: Number.NaN,
		} as unknown as StyleSpecification;
		const plain = new SVGMapRenderer({ style: makeStyle() });
		expect(await new SVGMapRenderer({ style }).renderSVG()).toBe(await plain.renderSVG());
	});

	test("renders with the style's global state, overridden by the option", async () => {
		const withColor = (color: string): StyleSpecification => {
			const style = makeStyle();
			style.layers[0] = {
				id: 'background',
				type: 'background',
				paint: { 'background-color': color },
			};
			return style;
		};
		const style = makeStyle();
		style.state = { color: { default: '#ff0000' } };
		style.layers[0] = {
			id: 'background',
			type: 'background',
			paint: { 'background-color': ['global-state', 'color'] },
		};
		const render = (options: object) => new SVGMapRenderer({ style, ...options }).renderSVG();

		expect(await render({})).toBe(
			await new SVGMapRenderer({ style: withColor('#ff0000') }).renderSVG(),
		);
		expect(await render({ globalState: { color: '#0000ff' } })).toBe(
			await new SVGMapRenderer({ style: withColor('#0000ff') }).renderSVG(),
		);
	});

	describe('labels', () => {
		const GLYPHS_URL = 'https://example.com/glyphs/{fontstack}/{range}.pbf';
		/** makeStyle, with a label "AB" at the icons' point; with `glyphs`, the style has glyphs. */
		const labelStyle = (glyphs = true): StyleSpecification => {
			const style = makeStyle();
			style.layers = [
				style.layers[0]!,
				{
					id: 'label',
					type: 'symbol',
					source: 'points',
					layout: { 'text-field': 'AB', 'text-font': ['Test Regular'] },
				},
			];
			if (glyphs) style.glyphs = GLYPHS_URL;
			return style;
		};
		const glyphFetch = (letters = 'AB') =>
			vi.fn((url: string) => {
				if (url.startsWith('https://example.com/glyphs/Test Regular/0-255.pbf')) {
					const file = glyphFile(
						Array.from(letters, (char) => ({
							id: char.codePointAt(0)!,
							width: 10,
							height: 14,
							top: -3,
							advance: 14,
						})),
					);
					return Promise.resolve(new Response(file));
				}
				return Promise.resolve(new Response(null, { status: 404 }));
			});

		test('draws labels as glyphs, as text, or not at all', async () => {
			const render = (labels: 'none' | 'text' | 'glyphs' | 'glyphs-text') =>
				new SVGMapRenderer({
					style: labelStyle(),
					labels,
					fetch: glyphFetch(),
					onWarning: vi.fn(),
				}).renderSVG({ width: 200, height: 200, zoom: 3 });
			expect(await render('none')).not.toMatch(/<text|<use xlink:href="#glyph/);
			const text = await render('text');
			expect(text).toMatch(/<text[^>]*>AB<\/text>/);
			expect(text).not.toContain('#glyph');
			const glyphs = await render('glyphs');
			expect(glyphs.match(/<path id="glyph-\d"/g)).toHaveLength(2);
			expect(glyphs).not.toContain('<text');
			const overlaid = await render('glyphs-text');
			expect(overlaid).toContain('#glyph-0');
			expect(overlaid).toMatch(/fill-opacity="0"><tspan[^>]*textLength[^>]*>AB</);
		});

		test('draws them as glyphs with text for the deprecated renderLabels', async () => {
			const svg = await new SVGMapRenderer({
				style: labelStyle(),
				renderLabels: true,
				fetch: glyphFetch(),
			}).renderSVG({ width: 200, height: 200, zoom: 3 });
			expect(svg).toContain('#glyph-0');
			expect(svg).toContain('fill-opacity="0"');
		});

		test('falls back to text without glyphs, and says so', async () => {
			const onWarning = vi.fn();
			const svg = await new SVGMapRenderer({
				style: labelStyle(false),
				labels: 'glyphs',
				fetch: glyphFetch(),
				onWarning,
			}).renderSVG({ width: 200, height: 200, zoom: 3 });
			expect(svg).toMatch(/<text[^>]*>AB<\/text>/);
			expect(onWarning).toHaveBeenCalledWith(
				'The style has no "glyphs": labels are drawn as text.',
			);
		});

		test('draws a label as text if one of its glyphs is missing', async () => {
			const svg = await new SVGMapRenderer({
				style: labelStyle(),
				labels: 'glyphs',
				fetch: glyphFetch('A'),
				onWarning: vi.fn(),
			}).renderSVG({ width: 200, height: 200, zoom: 3 });
			expect(svg).toMatch(/<text[^>]*>AB<\/text>/);
			expect(svg).not.toContain('#glyph');
		});

		test('loads each glyph range once, and again after clearCache', async () => {
			const fetchFn = glyphFetch();
			const map = new SVGMapRenderer({ style: labelStyle(), labels: 'glyphs', fetch: fetchFn });
			const view = { width: 200, height: 200, zoom: 3 };
			await Promise.all([map.renderSVG(view), map.renderSVG(view)]);
			const glyphRequests = () =>
				fetchFn.mock.calls.filter(([url]) => url.includes('/glyphs/')).length;
			expect(glyphRequests()).toBe(1);
			map.clearCache();
			await map.renderSVG(view);
			expect(glyphRequests()).toBe(2);
		});
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
