import type { GeoJSON } from 'geojson';
import type { RenderJob } from '../renderer/svg.js';
import { loadVectorSource } from './vector.js';
import { loadGeoJSONSource } from './geojson.js';
import type { LayerFeatures, SourceFeatures } from '../geometry.js';
import { getTile, type TileLoader } from './tiles.js';

export { getRasterTiles } from './raster.js';
export { loadSprite, loadSpriteAtlas } from './sprite.js';
export type { SpriteAtlas, SpriteEntry } from './sprite.js';

export async function getLayerFeatures(
	job: RenderJob,
	loadTile: TileLoader = getTile,
): Promise<SourceFeatures> {
	const { width, height } = job.renderer;
	const { zoom, center } = job.view;
	const { sources } = job.style;

	const sourceFeatures: SourceFeatures = new Map();

	const loadPromises: Promise<void>[] = [];
	for (const [sourceName, sourceSpec] of Object.entries(sources)) {
		const source = sourceSpec as Record<string, unknown>;
		// Each source gets its own layers, so equal layer names in different sources never mix.
		const layerFeatures: LayerFeatures = new Map();

		switch (source.type) {
			case 'vector':
				sourceFeatures.set(sourceName, layerFeatures);
				loadPromises.push(
					loadVectorSource(
						source as unknown as { type: 'vector'; tiles?: string[]; maxzoom?: number },
						job,
						layerFeatures,
						loadTile,
					),
				);
				break;
			case 'geojson':
				// Data given as a URL is a string here only if it could not be loaded.
				if (typeof source.data === 'object' && source.data !== null) {
					sourceFeatures.set(sourceName, layerFeatures);
					loadGeoJSONSource({
						data: source.data as GeoJSON,
						width,
						height,
						zoom,
						center,
						layerFeatures,
						projection: job.projection,
					});
				}
				break;
		}
	}
	await Promise.all(loadPromises);

	return sourceFeatures;
}
