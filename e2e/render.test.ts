import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { renderMap } from '../src/pipeline/render.js';
import { SVGRenderer } from '../src/renderer/svg.js';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { RenderJob } from '../src/renderer/svg.js';
import { installFetchCache, uninstallFetchCache } from './fetch-cache.js';

beforeAll(() => {
	installFetchCache();
});

afterAll(() => {
	uninstallFetchCache();
});

// --- Helpers ---

function makeJob(
	style: StyleSpecification,
	center: [number, number] = [0, 0],
	zoom = 2,
): RenderJob {
	return {
		style,
		view: { center, zoom },
		renderer: new SVGRenderer({ width: 256, height: 256, scale: 1 }),
	};
}

function geojsonSource(data: unknown): StyleSpecification['sources'][string] {
	return { type: 'geojson', data } as StyleSpecification['sources'][string];
}

// --- Tests ---

describe('e2e: geojson source with circle layer', () => {
	test('renders circles from GeoJSON points', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					points: geojsonSource({
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: [0, 0] },
								properties: {},
							},
						],
					}),
				},
				layers: [
					{
						id: 'circles',
						type: 'circle',
						source: 'points',
						paint: { 'circle-radius': 10, 'circle-color': '#FF0000' },
					},
				],
			}),
		);

		expect(svg).toContain('<circle');
		expect(svg).toContain('fill="#FF0000"');
		expect(svg).toContain('r="10"');
	});

	test('renders circles with stroke', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					points: geojsonSource({
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: [0, 0] },
								properties: {},
							},
						],
					}),
				},
				layers: [
					{
						id: 'circles',
						type: 'circle',
						source: 'points',
						paint: {
							'circle-radius': 8,
							'circle-color': '#0000FF',
							'circle-stroke-width': 2,
							'circle-stroke-color': '#FFFFFF',
						},
					},
				],
			}),
		);

		expect(svg).toContain('<circle');
		expect(svg).toContain('fill="#0000FF"');
		expect(svg).toContain('stroke="#FFFFFF"');
		expect(svg).toContain('stroke-width="2"');
	});

	test('renders multiple points', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					points: geojsonSource({
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: [-10, 10] },
								properties: {},
							},
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: [10, -10] },
								properties: {},
							},
						],
					}),
				},
				layers: [
					{
						id: 'circles',
						type: 'circle',
						source: 'points',
						paint: { 'circle-radius': 5, 'circle-color': '#336699' },
					},
				],
			}),
		);

		const circleCount = (svg.match(/<circle /g) ?? []).length;
		expect(circleCount).toBe(2);
		expect(svg).toContain('fill="#336699"');
	});

	test('renders MultiPoint geometry', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					points: geojsonSource({
						type: 'Feature',
						geometry: {
							type: 'MultiPoint',
							coordinates: [
								[-5, 5],
								[5, -5],
								[0, 0],
							],
						},
						properties: {},
					}),
				},
				layers: [
					{
						id: 'circles',
						type: 'circle',
						source: 'points',
						paint: { 'circle-radius': 4, 'circle-color': '#00FF00' },
					},
				],
			}),
		);

		const circleCount = (svg.match(/<circle /g) ?? []).length;
		expect(circleCount).toBe(3);
	});

	test('hidden circle layer produces no circles', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					points: geojsonSource({
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: [0, 0] },
								properties: {},
							},
						],
					}),
				},
				layers: [
					{
						id: 'circles',
						type: 'circle',
						source: 'points',
						layout: { visibility: 'none' },
						paint: { 'circle-radius': 10, 'circle-color': '#FF0000' },
					},
				],
			}),
		);

		expect(svg).not.toContain('<circle');
	});
});

describe('e2e: geojson source with fill layer', () => {
	test('renders polygons from GeoJSON', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					polygons: geojsonSource({
						type: 'Feature',
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[-20, 20],
									[20, 20],
									[20, -20],
									[-20, -20],
									[-20, 20],
								],
							],
						},
						properties: {},
					}),
				},
				layers: [
					{
						id: 'fill',
						type: 'fill',
						source: 'polygons',
						paint: { 'fill-color': '#00FF00' },
					},
				],
			}),
		);

		expect(svg).toContain('<path d=');
		expect(svg).toContain('fill="#00FF00"');
	});

	test('fills a GeoJSON polygon exactly once (no linestring-twin duplicate)', async () => {
		// A GeoJSON polygon is also materialized as a boundary line (so `line` layers
		// can stroke its rings). Regression: the fill layer, which consumes polygons +
		// linestrings, must not fill that boundary twin too — one fill path, not two.
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					polygons: geojsonSource({
						type: 'Feature',
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[-20, 20],
									[20, 20],
									[20, -20],
									[-20, -20],
									[-20, 20],
								],
							],
						},
						properties: {},
					}),
				},
				layers: [
					{ id: 'fill', type: 'fill', source: 'polygons', paint: { 'fill-color': '#00FF00' } },
				],
			}),
		);

		const fills = [...svg.matchAll(/fill="#00FF00"/g)];
		expect(fills).toHaveLength(1);
	});

	test('a line layer still strokes GeoJSON polygon boundaries', async () => {
		// The boundary twin lives in polygonOutlines now; `line` layers must still draw it.
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					polygons: geojsonSource({
						type: 'Feature',
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[-20, 20],
									[20, 20],
									[20, -20],
									[-20, -20],
									[-20, 20],
								],
							],
						},
						properties: {},
					}),
				},
				layers: [
					{ id: 'stroke', type: 'line', source: 'polygons', paint: { 'line-color': '#FF00FF' } },
				],
			}),
		);

		expect(svg).toContain('stroke="#FF00FF"');
	});
});

describe('e2e: geojson source with line layer', () => {
	test('renders lines from GeoJSON', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					lines: geojsonSource({
						type: 'Feature',
						geometry: {
							type: 'LineString',
							coordinates: [
								[-20, 0],
								[20, 0],
							],
						},
						properties: {},
					}),
				},
				layers: [
					{
						id: 'line',
						type: 'line',
						source: 'lines',
						paint: { 'line-color': '#FF00FF', 'line-width': 3 },
					},
				],
			}),
		);

		expect(svg).toContain('<path d=');
		expect(svg).toContain('stroke="#FF00FF"');
	});
});

describe('e2e: geojson source with multiple layers', () => {
	test('renders circles and fills from same source', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					data: geojsonSource({
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: [0, 0] },
								properties: {},
							},
							{
								type: 'Feature',
								geometry: {
									type: 'Polygon',
									coordinates: [
										[
											[-10, 10],
											[10, 10],
											[10, -10],
											[-10, -10],
											[-10, 10],
										],
									],
								},
								properties: {},
							},
						],
					}),
				},
				layers: [
					{
						id: 'fill',
						type: 'fill',
						source: 'data',
						paint: { 'fill-color': '#00FF00' },
					},
					{
						id: 'circles',
						type: 'circle',
						source: 'data',
						paint: { 'circle-radius': 6, 'circle-color': '#FF0000' },
					},
				],
			}),
		);

		expect(svg).toContain('<circle');
		expect(svg).toContain('fill="#FF0000"');
		expect(svg).toContain('<path d=');
		expect(svg).toContain('fill="#00FF00"');
	});
});

describe('e2e: vector tile source', () => {
	test('renders polygons from vector tiles', async () => {
		const svg = await renderMap(
			makeJob(
				{
					version: 8,
					sources: {
						'versatiles-shortbread': {
							type: 'vector',
							tiles: ['https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}'],
							maxzoom: 14,
						},
					},
					layers: [
						{
							id: 'water',
							type: 'fill',
							source: 'versatiles-shortbread',
							'source-layer': 'water_polygons',
							paint: { 'fill-color': '#0000FF' },
						},
					],
				},
				[13.4, 52.5], // Berlin
				10,
			),
		);

		expect(svg).toContain('<svg');
		expect(svg).toContain('</svg>');
		// At zoom 10 over Berlin, water features should be present
		expect(svg).toContain('<path d=');
		expect(svg).toContain('fill="#0000FF"');
	});
});

describe('e2e: empty source', () => {
	test('geojson source with no features produces no output', async () => {
		const svg = await renderMap(
			makeJob({
				version: 8,
				sources: {
					empty: geojsonSource({
						type: 'FeatureCollection',
						features: [],
					}),
				},
				layers: [
					{
						id: 'circles',
						type: 'circle',
						source: 'empty',
						paint: { 'circle-radius': 5, 'circle-color': '#FF0000' },
					},
				],
			}),
		);

		expect(svg).not.toContain('<circle');
		expect(svg).not.toContain('<path');
	});
});
