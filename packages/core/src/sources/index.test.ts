import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Renderer, RenderJob } from '../renderer/svg.js';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

vi.mock('./vector.js', () => ({
	loadVectorSource: vi.fn(),
}));
vi.mock('./geojson.js', () => ({
	loadGeoJSONSource: vi.fn(),
}));

// Import after mocking
const { getLayerFeatures } = await import('./index.js');
const { loadVectorSource } = await import('./vector.js');
const { loadGeoJSONSource } = await import('./geojson.js');

afterEach(() => {
	vi.clearAllMocks();
});

function makeJob(sources: Record<string, unknown>): RenderJob {
	return {
		renderer: { width: 512, height: 512 } as Renderer,
		view: { zoom: 2, center: [0, 0] },
		style: { sources, version: 8, layers: [] } as unknown as StyleSpecification,
	};
}

describe('getLayerFeatures', () => {
	test('returns empty map when no sources', async () => {
		const result = await getLayerFeatures(makeJob({}));
		expect(result.size).toBe(0);
	});

	test('calls loadVectorSource for vector sources', async () => {
		const job = makeJob({ vec: { type: 'vector', tiles: ['https://a/{z}/{x}/{y}.pbf'] } });
		await getLayerFeatures(job);

		expect(loadVectorSource).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'vector' }),
			job,
			expect.any(Map),
			expect.any(Function),
		);
	});

	test('passes a given tile loader to loadVectorSource', async () => {
		const job = makeJob({ vec: { type: 'vector', tiles: ['https://a/{z}/{x}/{y}.pbf'] } });
		const loadTile = vi.fn();
		await getLayerFeatures(job, loadTile);

		expect(loadVectorSource).toHaveBeenCalledWith(
			expect.anything(),
			job,
			expect.any(Map),
			loadTile,
		);
	});

	test('calls loadGeoJSONSource for geojson sources with data', async () => {
		const geojsonData = { type: 'Point', coordinates: [0, 0] };
		const job = makeJob({ geo: { type: 'geojson', data: geojsonData } });
		await getLayerFeatures(job);

		expect(loadGeoJSONSource).toHaveBeenCalledWith({
			data: geojsonData,
			width: 512,
			height: 512,
			zoom: 2,
			center: [0, 0],
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			layerFeatures: expect.any(Map),
		});
	});

	test('keeps the features of each source apart', async () => {
		const job = makeJob({
			a: { type: 'vector', tiles: ['https://a/{z}/{x}/{y}.pbf'] },
			b: { type: 'vector', tiles: ['https://b/{z}/{x}/{y}.pbf'] },
			geo: { type: 'geojson', data: { type: 'Point', coordinates: [0, 0] } },
		});
		const result = await getLayerFeatures(job);

		expect([...result.keys()]).toEqual(['a', 'b', 'geo']);
		const maps = [...result.values()];
		expect(new Set(maps).size).toBe(3);

		const [vectorA, vectorB] = vi.mocked(loadVectorSource).mock.calls;
		expect(vectorA?.[2]).toBe(result.get('a'));
		expect(vectorB?.[2]).toBe(result.get('b'));
		expect(vi.mocked(loadGeoJSONSource).mock.calls[0]?.[0].layerFeatures).toBe(result.get('geo'));
	});

	test('skips geojson sources without data', async () => {
		const job = makeJob({ geo: { type: 'geojson' } });
		await getLayerFeatures(job);

		expect(loadGeoJSONSource).not.toHaveBeenCalled();
	});

	test('ignores unknown source types', async () => {
		const job = makeJob({ img: { type: 'image', url: 'https://example.com/img.png' } });
		const result = await getLayerFeatures(job);

		expect(result.size).toBe(0);
	});
});
