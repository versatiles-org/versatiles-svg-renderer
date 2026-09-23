import { describe, expect, test, vi } from 'vitest';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { resolveSources, resolveTileUrlTemplate } from './tilejson.js';

const TILEJSON_URL = 'https://example.com/data/osm/tiles.json';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('resolveSources', () => {
	test('completes a source from its TileJSON document', async () => {
		const fetchFn = vi.fn(() =>
			Promise.resolve(
				jsonResponse({
					tilejson: '3.0.0',
					tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
					minzoom: 0,
					maxzoom: 14,
					bounds: [-180, -85, 180, 85],
					vector_layers: [{ id: 'water' }],
				}),
			),
		);
		const { sources, complete } = await resolveSources(
			{ osm: { type: 'vector', url: TILEJSON_URL } },
			fetchFn,
		);

		expect(fetchFn).toHaveBeenCalledWith(TILEJSON_URL);
		expect(complete).toBe(true);
		expect(sources.osm).toEqual({
			type: 'vector',
			url: TILEJSON_URL,
			tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'],
			minzoom: 0,
			maxzoom: 14,
			bounds: [-180, -85, 180, 85],
		});
	});

	test('keeps values set in the style', async () => {
		const fetchFn = () =>
			Promise.resolve(jsonResponse({ tiles: ['https://a/{z}/{x}/{y}'], maxzoom: 14 }));
		const { sources } = await resolveSources(
			{ osm: { type: 'vector', url: TILEJSON_URL, maxzoom: 10 } },
			fetchFn,
		);
		expect(sources.osm).toMatchObject({ tiles: ['https://a/{z}/{x}/{y}'], maxzoom: 10 });
	});

	test('resolves relative tile URLs against the document', async () => {
		const fetchFn = () =>
			Promise.resolve(jsonResponse({ tiles: ['{z}/{x}/{y}', '/tiles/{z}/{x}/{y}.png?key={z}'] }));
		const { sources } = await resolveSources(
			{ osm: { type: 'raster', url: TILEJSON_URL } },
			fetchFn,
		);
		expect((sources.osm as { tiles: string[] }).tiles).toEqual([
			'https://example.com/data/osm/{z}/{x}/{y}',
			'https://example.com/tiles/{z}/{x}/{y}.png?key={z}',
		]);
	});

	test('leaves sources without a url untouched, without fetching', async () => {
		const fetchFn = vi.fn();
		const input: StyleSpecification['sources'] = {
			vec: { type: 'vector', tiles: ['https://a/{z}/{x}/{y}'] },
			geo: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
		};
		const { sources, complete } = await resolveSources(input, fetchFn);

		expect(fetchFn).not.toHaveBeenCalled();
		expect(complete).toBe(true);
		expect(sources).toEqual(input);
		expect(sources.vec).toBe(input.vec);
	});

	test('keeps the order of the sources', async () => {
		const fetchFn = () => Promise.resolve(jsonResponse({ tiles: ['https://a/{z}/{x}/{y}'] }));
		const { sources } = await resolveSources(
			{
				a: { type: 'vector', url: TILEJSON_URL },
				b: { type: 'vector', tiles: ['https://b/{z}/{x}/{y}'] },
				c: { type: 'raster', url: TILEJSON_URL },
			},
			fetchFn,
		);
		expect(Object.keys(sources)).toEqual(['a', 'b', 'c']);
	});

	test.each([
		['an error status', () => Promise.resolve(new Response(null, { status: 500 }))],
		['a network error', () => Promise.reject(new Error('offline'))],
		['invalid JSON', () => Promise.resolve(new Response('not json'))],
		['a JSON array', () => Promise.resolve(jsonResponse([]))],
	])('leaves the source as it is on %s, and is not complete', async (_, fetchFn) => {
		const input: StyleSpecification['sources'] = { osm: { type: 'vector', url: TILEJSON_URL } };
		const { sources, complete } = await resolveSources(input, fetchFn);
		expect(complete).toBe(false);
		expect(sources.osm).toBe(input.osm);
	});

	test('ignores tile URLs that are not strings', async () => {
		const fetchFn = () =>
			Promise.resolve(jsonResponse({ tiles: ['https://a/{z}/{x}/{y}', 42, null] }));
		const { sources } = await resolveSources(
			{ osm: { type: 'vector', url: TILEJSON_URL } },
			fetchFn,
		);
		expect((sources.osm as { tiles: string[] }).tiles).toEqual(['https://a/{z}/{x}/{y}']);
	});
});

describe('resolveTileUrlTemplate', () => {
	test('keeps absolute URLs as they are', () => {
		expect(resolveTileUrlTemplate('https://a.b/{z}/{x}/{y}.pbf', TILEJSON_URL)).toBe(
			'https://a.b/{z}/{x}/{y}.pbf',
		);
	});

	test('keeps the placeholders of a resolved URL', () => {
		expect(resolveTileUrlTemplate('../{z}/{x}/{y}@{ratio}x.png', TILEJSON_URL)).toBe(
			'https://example.com/data/{z}/{x}/{y}@{ratio}x.png',
		);
	});

	test('keeps a relative URL when the base is not absolute', () => {
		expect(resolveTileUrlTemplate('{z}/{x}/{y}', 'tiles.json')).toBe('{z}/{x}/{y}');
	});
});
