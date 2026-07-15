import type { GeoJSON } from 'geojson';
import type { RenderJob } from '../renderer/svg.js';
import { loadVectorSource } from './vector.js';
import { loadGeoJSONSource } from './geojson.js';
import type { LayerFeatures } from '../geometry.js';

export { getRasterTiles } from './raster.js';
export { loadSpriteAtlas } from './sprite.js';
export type { SpriteAtlas, SpriteEntry } from './sprite.js';

export async function getLayerFeatures(job: RenderJob): Promise<LayerFeatures> {
	const { width, height } = job.renderer;
	const { zoom, center } = job.view;
	const { sources } = job.style;

	const layerFeatures: LayerFeatures = new Map();

	const loadPromises: Promise<void>[] = [];
	for (const [sourceName, sourceSpec] of Object.entries(sources)) {
		const source = sourceSpec as Record<string, unknown>;

		switch (source.type) {
			case 'vector':
				loadPromises.push(
					loadVectorSource(
						source as unknown as { type: 'vector'; tiles?: string[]; maxzoom?: number },
						job,
						layerFeatures,
					),
				);
				break;
			case 'geojson':
				if (source.data) {
					loadGeoJSONSource({
						sourceName,
						data: source.data as GeoJSON,
						width,
						height,
						zoom,
						center,
						layerFeatures,
					});
				}
				break;
		}
	}
	await Promise.all(loadPromises);

	return layerFeatures;
}
