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
		);
	});

	test('calls loadGeoJSONSource for geojson sources with data', async () => {
		const geojsonData = { type: 'Point', coordinates: [0, 0] };
		const job = makeJob({ geo: { type: 'geojson', data: geojsonData } });
		await getLayerFeatures(job);

		expect(loadGeoJSONSource).toHaveBeenCalledWith({
			sourceName: 'geo',
			data: geojsonData,
			width: 512,
			height: 512,
			zoom: 2,
			center: [0, 0],
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			layerFeatures: expect.any(Map),
		});
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
