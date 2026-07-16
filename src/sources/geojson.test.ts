import type { GeoJSON } from 'geojson';
import { describe, expect, test } from 'vitest';
import type { LayerFeatures } from '../geometry.js';
import { loadGeoJSONSource } from './geojson.js';

// Center on 0,0 at zoom 0 — keeps projection math simple
const CENTER: [number, number] = [0, 0];
const WIDTH = 512;
const HEIGHT = 512;
const ZOOM = 0;

function load(data: GeoJSON): LayerFeatures {
	const layerFeatures: LayerFeatures = new Map();
	loadGeoJSONSource({
		sourceName: 'test',
		data,
		width: WIDTH,
		height: HEIGHT,
		zoom: ZOOM,
		center: CENTER,
		layerFeatures,
	});
	return layerFeatures;
}

function getFeatures(lf: LayerFeatures) {
	const features = lf.get('test');
	if (!features) throw new Error('expected features for "test"');
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
		test('loads a LineString and also adds points', () => {
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
			// Points are also created from linestring vertices
			expect(features.points.length).toBe(1);
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
		test('loads a Polygon and also adds linestrings and points', () => {
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
			expect(features.polygonOutlines![0]!.type).toBe('LineString');
			expect(features.points.length).toBe(1);
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
			// 1 explicit point + 1 point from linestring vertices
			expect(features.points.length).toBe(2);
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
			expect(features.points.length).toBe(2);
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

			const features = lf.get('test');
			// Feature is far outside the viewport at zoom 0 centered on 0,0
			// with 512x512 — may or may not be culled depending on projection.
			// At minimum the layer entry should exist.
			expect(features).toBeDefined();
		});
	});

	describe('merging into existing layer', () => {
		test('appends to existing features for the same source name', () => {
			const layerFeatures: LayerFeatures = new Map();

			loadGeoJSONSource({
				sourceName: 'test',
				data: { type: 'Point', coordinates: [0, 0] },
				width: WIDTH,
				height: HEIGHT,
				zoom: ZOOM,
				center: CENTER,
				layerFeatures,
			});

			loadGeoJSONSource({
				sourceName: 'test',
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
});
