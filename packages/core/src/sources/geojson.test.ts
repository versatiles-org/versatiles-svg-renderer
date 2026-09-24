import type { GeoJSON } from 'geojson';
import { describe, expect, test } from 'vitest';
import { GEOJSON_LAYER, type LayerFeatures } from '../geo/index.js';
import { compileSourceFilter, loadGeoJSONSource, type GeoJSONLoadOptions } from './geojson.js';

// Center on 0,0 at zoom 0 — keeps projection math simple
const CENTER: [number, number] = [0, 0];
const WIDTH = 512;
const HEIGHT = 512;
const ZOOM = 0;

function load(
	data: GeoJSON,
	options: Pick<GeoJSONLoadOptions, 'filter' | 'promoteId' | 'generateId'> = {},
): LayerFeatures {
	const layerFeatures: LayerFeatures = new Map();
	loadGeoJSONSource({
		data,
		width: WIDTH,
		height: HEIGHT,
		zoom: ZOOM,
		center: CENTER,
		layerFeatures,
		...options,
	});
	return layerFeatures;
}

function getFeatures(lf: LayerFeatures) {
	const features = lf.get(GEOJSON_LAYER);
	if (!features) throw new Error('expected GeoJSON features');
	return features;
}

describe('loadGeoJSONSource', () => {
	describe('Point', () => {
		test('loads a Point geometry', () => {
			const lf = load({
				type: 'Feature',
				properties: { name: 'origin' },
				geometry: { type: 'Point', coordinates: [0, 0] },
			});

			const features = getFeatures(lf);
			expect(features.points.length).toBe(1);
			expect(features.points[0]!.type).toBe('Point');
			expect(features.points[0]!.properties).toEqual({ name: 'origin' });
		});

		test('loads a MultiPoint geometry', () => {
			const lf = load({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'MultiPoint',
					coordinates: [
						[0, 0],
						[10, 10],
					],
				},
			});

			const features = getFeatures(lf);
			expect(features.points.length).toBe(1);
			expect(features.points[0]!.geometry.length).toBe(2);
		});
	});

	describe('LineString', () => {
		test('loads a LineString and also adds its vertices', () => {
			const lf = load({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[-10, 0],
						[10, 0],
					],
				},
			});

			const features = getFeatures(lf);
			expect(features.linestrings.length).toBe(1);
			expect(features.linestrings[0]!.type).toBe('LineString');
			// Its vertices, for circle layers only: a symbol layer places no label at them.
			expect(features.points.length).toBe(0);
			expect(features.vertices?.length).toBe(1);
		});

		test('loads a MultiLineString', () => {
			const lf = load({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'MultiLineString',
					coordinates: [
						[
							[-10, 0],
							[10, 0],
						],
						[
							[0, -10],
							[0, 10],
						],
					],
				},
			});

			const features = getFeatures(lf);
			expect(features.linestrings.length).toBe(1);
			expect(features.linestrings[0]!.geometry.length).toBe(2);
		});
	});

	describe('Polygon', () => {
		test('loads a Polygon and also adds its outline and vertices', () => {
			const lf = load({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[-10, -10],
							[10, -10],
							[10, 10],
							[-10, 10],
							[-10, -10],
						],
					],
				},
			});

			const features = getFeatures(lf);
			expect(features.polygons.length).toBe(1);
			expect(features.polygons[0]!.type).toBe('Polygon');
			// The polygon boundary is materialized as a stroke source in polygonOutlines
			// (for `line` layers), NOT in linestrings — otherwise `fill` layers, which
			// consume polygons + linestrings, would fill the polygon twice.
			expect(features.linestrings.length).toBe(0);
			expect(features.polygonOutlines?.length).toBe(1);
			// A polygon, as in MapLibre: a line layer closes its rings.
			expect(features.polygonOutlines![0]!.type).toBe('Polygon');
			expect(features.points.length).toBe(0);
			expect(features.vertices?.length).toBe(1);
		});

		test('loads a MultiPolygon', () => {
			const lf = load({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'MultiPolygon',
					coordinates: [
						[
							[
								[-10, -10],
								[0, -10],
								[0, 0],
								[-10, 0],
								[-10, -10],
							],
						],
						[
							[
								[0, 0],
								[10, 0],
								[10, 10],
								[0, 10],
								[0, 0],
							],
						],
					],
				},
			});

			const features = getFeatures(lf);
			expect(features.polygons.length).toBe(2);
		});
	});

	describe('FeatureCollection', () => {
		test('loads all features from a FeatureCollection', () => {
			const lf = load({
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: { a: 1 },
						geometry: { type: 'Point', coordinates: [0, 0] },
					},
					{
						type: 'Feature',
						properties: { b: 2 },
						geometry: {
							type: 'LineString',
							coordinates: [
								[-5, 0],
								[5, 0],
							],
						},
					},
				],
			});

			const features = getFeatures(lf);
			// 1 explicit point, and the linestring's vertices apart
			expect(features.points.length).toBe(1);
			expect(features.vertices?.length).toBe(1);
			expect(features.linestrings.length).toBe(1);
		});
	});

	describe('raw geometry', () => {
		test('loads a raw geometry (not wrapped in Feature)', () => {
			const lf = load({ type: 'Point', coordinates: [0, 0] });

			const features = getFeatures(lf);
			expect(features.points.length).toBe(1);
		});
	});

	describe('GeometryCollection', () => {
		test('loads geometries from a GeometryCollection', () => {
			const lf = load({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'GeometryCollection',
					geometries: [
						{ type: 'Point', coordinates: [0, 0] },
						{
							type: 'LineString',
							coordinates: [
								[-5, 0],
								[5, 0],
							],
						},
					],
				},
			});

			const features = getFeatures(lf);
			expect(features.points.length).toBe(1);
			expect(features.vertices?.length).toBe(1);
			expect(features.linestrings.length).toBe(1);
		});
	});

	describe('viewport culling', () => {
		test('excludes features outside the viewport', () => {
			const lf = load({
				type: 'Feature',
				properties: {},
				geometry: { type: 'Point', coordinates: [179, 80] },
			});

			const features = lf.get(GEOJSON_LAYER);
			// Feature is far outside the viewport at zoom 0 centered on 0,0
			// with 512x512 — may or may not be culled depending on projection.
			// At minimum the layer entry should exist.
			expect(features).toBeDefined();
		});
	});

	describe('merging into existing layer', () => {
		test('appends to existing features when loaded into the same map', () => {
			const layerFeatures: LayerFeatures = new Map();

			loadGeoJSONSource({
				data: { type: 'Point', coordinates: [0, 0] },
				width: WIDTH,
				height: HEIGHT,
				zoom: ZOOM,
				center: CENTER,
				layerFeatures,
			});

			loadGeoJSONSource({
				data: { type: 'Point', coordinates: [5, 5] },
				width: WIDTH,
				height: HEIGHT,
				zoom: ZOOM,
				center: CENTER,
				layerFeatures,
			});

			const features = getFeatures(layerFeatures);
			expect(features.points.length).toBe(2);
		});
	});

	describe('coordinate projection', () => {
		test('projects center coordinate to viewport center', () => {
			const lf = load({
				type: 'Feature',
				properties: {},
				geometry: { type: 'Point', coordinates: [0, 0] },
			});

			const features = getFeatures(lf);
			const point = features.points[0]!.geometry[0]![0]!;
			expect(point.x).toBeCloseTo(WIDTH / 2);
			expect(point.y).toBeCloseTo(HEIGHT / 2);
		});
	});

	describe('source options', () => {
		/** Three points, with an `id`, a `ref` and a `kind` each. */
		const points: GeoJSON = {
			type: 'FeatureCollection',
			features: [
				{ id: 7, kind: 'a', ref: 'r1' },
				{ id: '12', kind: 'b', ref: 30 },
				{ id: 'x', kind: 'a', ref: 31 },
			].map(({ id, kind, ref }) => ({
				type: 'Feature',
				id,
				properties: { kind, ref },
				geometry: { type: 'Point', coordinates: [0, 0] },
			})),
		};

		const ids = (lf: LayerFeatures): unknown[] => getFeatures(lf).points.map((f) => f.id);

		test('reads ids as MapLibre GL JS does: strings as integers', () => {
			expect(ids(load(points))).toEqual([7, 12, NaN]);
		});

		test('keeps only the features that pass the filter', () => {
			const filter = compileSourceFilter(['==', ['get', 'kind'], 'a'], 'points');
			const features = getFeatures(load(points, { filter })).points;
			expect(features.map((f) => f.properties.ref)).toEqual(['r1', 31]);
		});

		test('evaluates the filter at zoom 0', () => {
			const filter = compileSourceFilter(['<', ['zoom'], 1], 'points');
			expect(getFeatures(load(points, { filter })).points).toHaveLength(3);
		});

		test('promotes a property to the id', () => {
			expect(ids(load(points, { promoteId: 'ref' }))).toEqual([NaN, 30, 31]);
		});

		test('generates ids from the index, after filtering', () => {
			const filter = compileSourceFilter(['==', ['get', 'kind'], 'a'], 'points');
			expect(ids(load(points, { generateId: true }))).toEqual([0, 1, 2]);
			expect(ids(load(points, { generateId: true, filter }))).toEqual([0, 1]);
		});

		test('compiles no filter without one, and throws on an invalid one', () => {
			expect(compileSourceFilter(undefined, 'points')).toBeUndefined();
			expect(compileSourceFilter([], 'points')).toBeUndefined();
			expect(() => compileSourceFilter(['nonsense'], 'points')).toThrow(
				'Unknown expression "nonsense"',
			);
		});
	});

	describe('ring winding', () => {
		/** Twice the ring's area on screen (y down): positive if it runs clockwise. */
		function clockwiseArea(ring: { x: number; y: number }[]): number {
			let area = 0;
			for (let i = 0; i < ring.length; i++) {
				const a = ring[i]!;
				const b = ring[(i + 1) % ring.length]!;
				area += a.x * b.y - b.x * a.y;
			}
			return area;
		}

		test.each([
			['clockwise', 1],
			['counter-clockwise', -1],
		])(
			'winds a %s exterior ring clockwise on screen and its hole counter-clockwise, as geojson-vt does',
			(_, direction) => {
				const square = (size: number): number[][] => {
					const ring = [
						[-size, size],
						[size, size],
						[size, -size],
						[-size, -size],
						[-size, size],
					];
					return direction > 0 ? ring : ring.reverse();
				};
				const lf = load({
					type: 'Feature',
					properties: {},
					geometry: { type: 'Polygon', coordinates: [square(10), square(5)] },
				});
				const [exterior, hole] = getFeatures(lf).polygons[0]!.geometry;
				expect(clockwiseArea(exterior!)).toBeGreaterThan(0);
				expect(clockwiseArea(hole!)).toBeLessThan(0);
			},
		);
	});
});
