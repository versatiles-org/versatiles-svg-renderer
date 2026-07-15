import { describe, expect, test, vi } from 'vitest';
import type { LayerFeatures } from '../geometry.js';
import type { RenderJob } from '../renderer/svg.js';
import { SVGRenderer } from '../renderer/svg.js';

vi.mock('./tiles.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('./tiles.js')>();
	return {
		...original,
		getTile: vi.fn(),
	};
});

let mockVtLayers: Record<string, unknown> = {};

vi.mock('@mapbox/vector-tile', () => {
	return {
		VectorTile: class {
			layers: Record<string, unknown>;
			constructor() {
				this.layers = mockVtLayers;
			}
		},
	};
});

vi.mock('pbf', () => {
	return {
		// eslint-disable-next-line @typescript-eslint/no-extraneous-class
		PbfReader: class {},
	};
});

const { getTile } = await import('./tiles.js');
const { loadVectorSource } = await import('./vector.js');

function makeJob(width = 512, height = 512, zoom = 0): RenderJob {
	return {
		renderer: new SVGRenderer({ width, height }),
		style: { version: 8 as const, sources: {}, layers: [] },
		view: { center: [0, 0] as [number, number], zoom },
	};
}

function setMockLayers(
	layers: Record<
		string,
		{
			type: number;
			geometry: { x: number; y: number }[][];
			properties: Record<string, unknown>;
			id?: number;
		}[]
	>,
): void {
	const vtLayers: Record<string, { length: number; feature: (i: number) => unknown }> = {};
	for (const [name, features] of Object.entries(layers)) {
		vtLayers[name] = {
			length: features.length,
			feature: (i: number) => ({
				type: features[i]!.type,
				id: features[i]!.id,
				properties: features[i]!.properties,
				loadGeometry: () => features[i]!.geometry,
			}),
		};
	}
	mockVtLayers = vtLayers;
}

describe('loadVectorSource', () => {
	test('returns early if no tiles URL', async () => {
		const layerFeatures: LayerFeatures = new Map();
		await loadVectorSource({ type: 'vector' }, makeJob(), layerFeatures);
		expect(layerFeatures.size).toBe(0);
	});

	test('returns early if getTile returns null', async () => {
		vi.mocked(getTile).mockResolvedValueOnce(null);
		const layerFeatures: LayerFeatures = new Map();
		await loadVectorSource(
			{ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
			makeJob(),
			layerFeatures,
		);
		expect(layerFeatures.size).toBe(0);
	});

	test('loads point features from vector tile', async () => {
		vi.mocked(getTile).mockResolvedValueOnce({
			buffer: new ArrayBuffer(0),
			contentType: 'application/x-protobuf',
		});
		setMockLayers({
			testLayer: [
				{
					type: 1, // Point
					geometry: [[{ x: 2048, y: 2048 }]],
					properties: { name: 'test' },
					id: 1,
				},
			],
		});

		const layerFeatures: LayerFeatures = new Map();
		await loadVectorSource(
			{ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
			makeJob(),
			layerFeatures,
		);

		const features = layerFeatures.get('testLayer');
		expect(features).toBeDefined();
		const f = features ?? { points: [], linestrings: [], polygons: [] };
		expect(f.points.length).toBe(1);
		expect(f.points[0]!.type).toBe('Point');
		expect(f.points[0]!.properties).toEqual({ name: 'test' });
	});

	test('loads linestring features from vector tile', async () => {
		vi.mocked(getTile).mockResolvedValueOnce({
			buffer: new ArrayBuffer(0),
			contentType: 'application/x-protobuf',
		});
		setMockLayers({
			roads: [
				{
					type: 2, // LineString
					geometry: [
						[
							{ x: 0, y: 0 },
							{ x: 4096, y: 4096 },
						],
					],
					properties: {},
				},
			],
		});

		const layerFeatures: LayerFeatures = new Map();
		await loadVectorSource(
			{ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
			makeJob(),
			layerFeatures,
		);

		const features = layerFeatures.get('roads');
		expect(features).toBeDefined();
		const f = features ?? { points: [], linestrings: [], polygons: [] };
		expect(f.linestrings.length).toBe(1);
		expect(f.linestrings[0]!.type).toBe('LineString');
	});

	test('loads polygon features from vector tile', async () => {
		vi.mocked(getTile).mockResolvedValueOnce({
			buffer: new ArrayBuffer(0),
			contentType: 'application/x-protobuf',
		});
		setMockLayers({
			buildings: [
				{
					type: 3, // Polygon
					geometry: [
						[
							{ x: 0, y: 0 },
							{ x: 4096, y: 0 },
							{ x: 4096, y: 4096 },
							{ x: 0, y: 4096 },
						],
					],
					properties: {},
				},
			],
		});

		const layerFeatures: LayerFeatures = new Map();
		await loadVectorSource(
			{ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
			makeJob(),
			layerFeatures,
		);

		const features = layerFeatures.get('buildings');
		expect(features).toBeDefined();
		const f = features ?? { points: [], linestrings: [], polygons: [] };
		expect(f.polygons.length).toBe(1);
		expect(f.polygons[0]!.type).toBe('Polygon');
	});

	test('throws on unknown feature type', async () => {
		vi.mocked(getTile).mockResolvedValueOnce({
			buffer: new ArrayBuffer(0),
			contentType: 'application/x-protobuf',
		});
		setMockLayers({
			testLayer: [
				{
					type: 0, // Unknown
					geometry: [[{ x: 0, y: 0 }]],
					properties: {},
				},
			],
		});

		const layerFeatures: LayerFeatures = new Map();
		await expect(
			loadVectorSource(
				{ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
				makeJob(),
				layerFeatures,
			),
		).rejects.toThrow('Unknown feature type');
	});

	test('respects maxzoom', async () => {
		vi.mocked(getTile).mockResolvedValue(null);

		const layerFeatures: LayerFeatures = new Map();
		await loadVectorSource(
			{ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'], maxzoom: 5 },
			makeJob(512, 512, 10),
			layerFeatures,
		);

		expect(vi.mocked(getTile)).toHaveBeenCalledWith(
			expect.any(String),
			5,
			expect.any(Number),
			expect.any(Number),
		);
	});

	test('merges features from multiple layers', async () => {
		vi.mocked(getTile).mockResolvedValueOnce({
			buffer: new ArrayBuffer(0),
			contentType: 'application/x-protobuf',
		});
		setMockLayers({
			layerA: [{ type: 1, geometry: [[{ x: 2048, y: 2048 }]], properties: { a: 1 } }],
			layerB: [
				{
					type: 2,
					geometry: [
						[
							{ x: 0, y: 0 },
							{ x: 4096, y: 4096 },
						],
					],
					properties: { b: 2 },
				},
			],
		});

		const layerFeatures: LayerFeatures = new Map();
		await loadVectorSource(
			{ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
			makeJob(),
			layerFeatures,
		);

		expect(layerFeatures.has('layerA')).toBe(true);
		expect(layerFeatures.has('layerB')).toBe(true);
		const fA = layerFeatures.get('layerA') ?? { points: [], linestrings: [], polygons: [] };
		const fB = layerFeatures.get('layerB') ?? { points: [], linestrings: [], polygons: [] };
		expect(fA.points.length).toBe(1);
		expect(fB.linestrings.length).toBe(1);
	});
});
