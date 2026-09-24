import { describe, expect, test, vi } from 'vitest';
import type { LayerFeatures } from '../geometry.js';
import type { RenderJob } from '../types.js';
import { SVGRenderer } from '../renderer/svg/index.js';

vi.mock('./tiles.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('./tiles.js')>();
	return {
		...original,
		getTile: vi.fn(),
	};
});

let mockVtLayers: Record<string, unknown> = {};
/** Layers of particular tiles, by their buffer; any other tile has `mockVtLayers`. */
const mockVtLayersByBuffer = new Map<ArrayBuffer, Record<string, unknown>>();

vi.mock('@mapbox/vector-tile', () => {
	return {
		VectorTile: class {
			layers: Record<string, unknown>;
			constructor(pbf: { buffer: ArrayBuffer }) {
				this.layers = mockVtLayersByBuffer.get(pbf.buffer) ?? mockVtLayers;
			}
		},
	};
});

vi.mock('pbf', () => {
	return {
		PbfReader: class {
			constructor(readonly buffer: ArrayBuffer) {}
		},
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

	test('requests tiles as the source says: minzoom, scheme', async () => {
		vi.mocked(getTile).mockResolvedValue(null);
		const tiles = ['https://example.com/{z}/{x}/{y}.pbf'];
		const layerFeatures: LayerFeatures = new Map();

		await loadVectorSource({ type: 'vector', tiles, minzoom: 20 }, makeJob(), layerFeatures);
		expect(getTile).not.toHaveBeenCalled();

		await loadVectorSource({ type: 'vector', tiles, scheme: 'tms' }, makeJob(), layerFeatures);
		const xyz = vi.mocked(getTile).mock.calls.map(([, z, x, y]) => [z, x, y]);
		vi.mocked(getTile).mockClear();
		await loadVectorSource({ type: 'vector', tiles }, makeJob(), layerFeatures);
		const flipped = vi.mocked(getTile).mock.calls.map(([, z, x, y]) => [z, x, 2 ** z - 1 - y]);
		expect(xyz.length).toBeGreaterThan(0);
		expect(xyz).toEqual(flipped);
		vi.mocked(getTile).mockReset();
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
		// Line layers stroke the polygon's rings: the same geometry, as a polygon.
		expect(f.polygonOutlines).toHaveLength(1);
		expect(f.polygonOutlines![0]!.type).toBe('Polygon');
		expect(f.polygonOutlines![0]!.geometry).toBe(f.polygons[0]!.geometry);
	});

	test('outlines a polygon clipped to its tile without the clipped edges', async () => {
		vi.mocked(getTile).mockResolvedValueOnce({
			buffer: new ArrayBuffer(0),
			contentType: 'application/x-protobuf',
		});
		setMockLayers({
			buildings: [
				{
					type: 3, // Polygon, reaching 100 units into the tile buffer on the right
					geometry: [
						[
							{ x: 1000, y: 1000 },
							{ x: 4196, y: 1000 },
							{ x: 4196, y: 2000 },
							{ x: 1000, y: 2000 },
							{ x: 1000, y: 1000 },
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
		const [polygon] = layerFeatures.get('buildings')!.polygons;
		const [outline] = layerFeatures.get('buildings')!.polygonOutlines!;
		// One open line: along the bottom, the left side and the top, not the tile's edge.
		expect(outline!.geometry).toBe(polygon!.outline);
		expect(outline!.geometry).toHaveLength(1);
		const line = outline!.geometry[0]!;
		expect(line).toHaveLength(4);
		expect(line[0]!.x).toBeCloseTo(line[3]!.x);
		expect(line[0]!.y).not.toBeCloseTo(line[3]!.y);
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

	test('orders features by tile, not by the order the tiles arrive', async () => {
		// Four tiles at zoom 1, each with one point in its middle, named after the tile.
		const buffers = new Map<string, ArrayBuffer>();
		for (const key of ['0/0', '0/1', '1/0', '1/1']) {
			const buffer = new ArrayBuffer(1);
			buffers.set(key, buffer);
			mockVtLayersByBuffer.set(buffer, {
				places: {
					length: 1,
					feature: () => ({
						type: 1,
						properties: { tile: key },
						loadGeometry: () => [[{ x: 2048, y: 2048 }]],
					}),
				},
			});
		}

		async function load(delay: (key: string) => number): Promise<unknown[]> {
			vi.mocked(getTile).mockImplementation(async (_url, _z, x, y) => {
				const key = `${String(x)}/${String(y)}`;
				await new Promise((resolve) => setTimeout(resolve, delay(key)));
				return { buffer: buffers.get(key)!, contentType: 'application/x-protobuf' };
			});
			const layerFeatures: LayerFeatures = new Map();
			await loadVectorSource(
				{ type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] },
				makeJob(1024, 1024, 1),
				layerFeatures,
			);
			return layerFeatures.get('places')!.points.map((f) => f.properties.tile);
		}

		const order = ['0/0', '0/1', '1/0', '1/1'];
		const forwards = await load((key) => order.indexOf(key) * 5);
		const backwards = await load((key) => (3 - order.indexOf(key)) * 5);
		expect(forwards).toHaveLength(4);
		expect(backwards).toEqual(forwards);
		mockVtLayersByBuffer.clear();
	});
});
