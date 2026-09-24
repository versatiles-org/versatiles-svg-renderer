import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { checkSources, checkStyle, SUPPORTED_PROPERTIES } from './support.js';

function makeStyle(
	layers: LayerSpecification[],
	extra: Partial<StyleSpecification> = {},
): StyleSpecification {
	return { version: 8, sources: {}, layers, ...extra };
}

const fill = (id: string, paint: Record<string, unknown> = {}): LayerSpecification => ({
	id,
	type: 'fill',
	source: 's',
	'source-layer': 'l',
	paint,
});

describe('SUPPORTED_PROPERTIES', () => {
	// A property read in render.ts but missing here would be reported as unsupported; one
	// listed here but no longer read would be dropped without a warning.
	test('lists exactly the properties render.ts reads', () => {
		const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
		const read = new Set(
			[...source.matchAll(/get(?:Paint|Layout)\('([a-z-]+)'/g)].map((m) => m[1]),
		);
		const listed = new Set(Object.values(SUPPORTED_PROPERTIES).flat());
		expect([...listed].sort()).toEqual([...read].sort());
	});

	test('names each property under its own layer type', () => {
		for (const [type, properties] of Object.entries(SUPPORTED_PROPERTIES)) {
			for (const property of properties) {
				const prefix = property.split('-')[0];
				expect(type === 'symbol' ? ['symbol', 'text', 'icon'] : [type]).toContain(prefix);
			}
		}
	});
});

describe('checkStyle', () => {
	test('reports nothing for a supported style', () => {
		const style = makeStyle([
			{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
			fill('water', { 'fill-color': '#00f', 'fill-translate-anchor': 'viewport' }),
		]);
		expect(checkStyle(style, true)).toEqual([]);
	});

	test('reports unsupported layer types, once per type', () => {
		const style = makeStyle([
			{ id: 'b1', type: 'fill-extrusion', source: 's', 'source-layer': 'l' },
			{ id: 'b2', type: 'fill-extrusion', source: 's', 'source-layer': 'l' },
			{ id: 'heat', type: 'heatmap', source: 's' },
		]);
		expect(checkStyle(style, false)).toEqual([
			'Layers of type "fill-extrusion" are not supported and are not drawn: "b1", "b2".',
			'Layers of type "heatmap" are not supported and are not drawn: "heat".',
		]);
	});

	test('reports unsupported properties in one warning, with the layers using them', () => {
		const style = makeStyle([
			fill('a', { 'fill-past': 'x' }),
			fill('b', { 'fill-past': 'x' }),
			// Properties no renderer knows.
			fill('c', { 'fill-past': 'x', 'fill-future': 1 }),
			fill('d', { 'fill-past': 'x' }),
			fill('e', { 'fill-past': 'x' }),
		]);
		expect(checkStyle(style, false)).toEqual([
			'These layer properties are not supported and are ignored: fill-past ("a", "b", "c", 2 more), fill-future ("c").',
		]);
	});

	test('skips hidden layers', () => {
		const style = makeStyle([
			{
				...fill('a', { 'fill-past': 'x' }),
				layout: { visibility: 'none' },
			},
			{ id: 'h', type: 'heatmap', source: 's', layout: { visibility: 'none' } },
		]);
		expect(checkStyle(style, false)).toEqual([]);
	});

	test('checks symbol layers only when labels are rendered', () => {
		const style = makeStyle([
			{ id: 'label', type: 'symbol', source: 's', layout: { 'text-variable-anchor': ['top'] } },
		]);
		expect(checkStyle(style, false)).toEqual([]);
		expect(checkStyle(style, true)).toEqual([
			'These layer properties are not supported and are ignored: text-variable-anchor ("label").',
		]);
	});

	test('accepts icon-text-fit and labels along lines', () => {
		const fit: LayerSpecification = {
			id: 'shields',
			type: 'symbol',
			source: 's',
			layout: { 'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 4, 2, 4] },
		};
		expect(checkStyle(makeStyle([fit]), true)).toEqual([]);
		// Labels along lines are supported.
		const line: LayerSpecification = {
			id: 'streets',
			type: 'symbol',
			source: 's',
			layout: { 'symbol-placement': 'line', 'text-field': '{name}' },
		};
		expect(checkStyle(makeStyle([line]), true)).toEqual([]);
	});

	test('reports terrain', () => {
		const style = makeStyle([], { terrain: { source: 'dem' } });
		expect(checkStyle(style, false)).toEqual([
			'The style property "terrain" is not supported and is ignored.',
		]);
	});

	test('reports the sky on the globe only', () => {
		const sky = { 'sky-color': '#fff' };
		expect(checkStyle(makeStyle([], { sky }), false)).toEqual([]);
		expect(checkStyle(makeStyle([], { sky, projection: { type: 'mercator' } }), false)).toEqual([]);
		expect(checkStyle(makeStyle([], { sky, projection: { type: 'globe' } }), false)).toEqual([
			'The style property "sky" is not supported: the globe has no atmosphere.',
		]);
	});
});

describe('checkSources', () => {
	test('reports nothing for supported sources', () => {
		expect(
			checkSources({
				v: { type: 'vector', tiles: ['https://a/{z}/{x}/{y}'] },
				r: { type: 'raster', tiles: ['https://a/{z}/{x}/{y}'], scheme: 'tms' },
				g: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
				i: {
					type: 'image',
					url: 'https://a/b.png',
					coordinates: [
						[0, 1],
						[1, 1],
						[1, 0],
						[0, 0],
					],
				},
			}),
		).toEqual([]);
	});

	test('reports unsupported source types', () => {
		expect(
			checkSources({
				dem: { type: 'raster-dem', tiles: ['https://a/{z}/{x}/{y}'] },
				vid: {
					type: 'video',
					urls: ['https://a/b.mp4'],
					coordinates: [
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 1],
					],
				},
			}),
		).toEqual([
			'Source "dem": the type "raster-dem" is not supported; its layers are not drawn.',
			'Source "vid": the type "video" is not supported; its layers are not drawn.',
		]);
	});

	test('reports a TileJSON document that was not loaded, and a source without tiles', () => {
		expect(
			checkSources({
				a: { type: 'vector', url: 'https://a/tiles.json' },
				b: { type: 'raster' },
			}),
		).toEqual([
			'Source "a": the TileJSON document could not be loaded from https://a/tiles.json; the source is empty.',
			'Source "b": it has neither "tiles" nor "url"; the source is empty.',
		]);
	});

	test('reports GeoJSON data that was not loaded', () => {
		expect(
			checkSources({
				g: { type: 'geojson', data: 'https://a/data.geojson' },
			}),
		).toEqual([
			'Source "g": the GeoJSON data could not be loaded from https://a/data.geojson; the source is empty.',
		]);
	});
});
