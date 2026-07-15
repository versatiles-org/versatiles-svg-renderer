import { Point2D, Feature } from '../geometry.js';
import type { RenderJob } from '../renderer/svg.js';
import { calculateTileGrid, getTile } from './tiles.js';
import type { LayerFeatures } from '../geometry.js';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const TILE_EXTENT = 4096;
const VTFeatureType = { Unknown: 0, Point: 1, LineString: 2, Polygon: 3 } as const;

interface VectorSourceSpec {
	type: 'vector';
	tiles?: string[];
	maxzoom?: number;
}

export async function loadVectorSource(
	source: VectorSourceSpec,
	job: RenderJob,
	layerFeatures: LayerFeatures,
): Promise<void> {
	const tiles = source.tiles;
	if (!tiles) return;

	const { width, height } = job.renderer;
	const { zoom, center } = job.view;

	const {
		zoomLevel,
		tileSize,
		tiles: tileCoordinates,
	} = calculateTileGrid(width, height, center, zoom, source.maxzoom);

	await Promise.all(
		tileCoordinates.map(async ({ x, y, offsetX, offsetY }): Promise<void> => {
			const offset = new Point2D(offsetX, offsetY);

			const tile = await getTile(tiles[0]!, zoomLevel, x, y);
			if (!tile) return;

			const vectorTile = new VectorTile(new PbfReader(tile.buffer));
			for (const [name, layer] of Object.entries(vectorTile.layers)) {
				let features = layerFeatures.get(name);
				if (!features) {
					features = { points: [], linestrings: [], polygons: [] };
					layerFeatures.set(name, features);
				}

				for (let i = 0; i < layer.length; i++) {
					const featureSrc = layer.feature(i);
					const geometry = featureSrc
						.loadGeometry()
						.map((ring) =>
							ring.map((point) =>
								new Point2D(point.x, point.y).scale(tileSize / TILE_EXTENT).translate(offset),
							),
						);

					let type: 'LineString' | 'Point' | 'Polygon';
					let list: Feature[];
					switch (featureSrc.type) {
						case VTFeatureType.Unknown:
							throw Error('Unknown feature type in vector tile');
						case VTFeatureType.Point:
							type = 'Point';
							list = features.points;
							break;
						case VTFeatureType.LineString:
							type = 'LineString';
							list = features.linestrings;
							break;
						case VTFeatureType.Polygon:
							type = 'Polygon';
							list = features.polygons;
							break;
					}

					// Split MultiPoint into individual Point features
					if (type === 'Point' && geometry.length > 1) {
						for (const ring of geometry) {
							const feature = new Feature({
								type,
								geometry: [ring],
								id: featureSrc.id,
								properties: featureSrc.properties,
							});
							if (feature.doesOverlap([0, 0, width, height])) list.push(feature);
						}
					} else {
						const feature = new Feature({
							type,
							geometry,
							id: featureSrc.id,
							properties: featureSrc.properties,
						});
						if (feature.doesOverlap([0, 0, width, height])) list.push(feature);
					}
				}
			}
		}),
	);
}
