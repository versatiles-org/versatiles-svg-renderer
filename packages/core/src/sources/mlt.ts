import { decodeTile, GEOMETRY_TYPE, type Feature as MLTFeature } from '@maplibre/mlt';
import type { VectorTileFeature, VectorTileLayer } from '@mapbox/vector-tile';
import type { XY } from './clip.js';

/** What the renderer reads of a vector tile's layer, whether MVT or MLT. */
export type TileLayer = Pick<VectorTileLayer, 'length' | 'extent'> & {
	feature(i: number): TileFeature;
};

/** What the renderer reads of a vector tile's feature, whether MVT or MLT. */
export type TileFeature = Pick<VectorTileFeature, 'type' | 'id' | 'properties'> & {
	loadGeometry(): XY[][];
};

/**
 * The layers of an MLT (MapLibre Tile) vector tile, as MapLibre GL JS reads it for a source
 * with `encoding: "mlt"`, in the form of an MVT's layers.
 */
export function decodeMLT(buffer: ArrayBuffer): Record<string, TileLayer> {
	const layers: Record<string, TileLayer> = {};
	for (const table of decodeTile(new Uint8Array(buffer))) {
		const features = table.getFeatures();
		const extent = table.extent;
		layers[table.name] = {
			length: features.length,
			extent,
			feature: (i) => toTileFeature(features[i]!),
		};
	}
	return layers;
}

function toTileFeature(feature: MLTFeature): TileFeature {
	const coordinates = feature.geometry.coordinates;
	return {
		type: featureType(feature.geometry.type),
		id: feature.id === undefined ? undefined : Number(feature.id),
		properties: feature.properties as TileFeature['properties'],
		loadGeometry: () => coordinates.map((ring) => ring.map(({ x, y }) => ({ x, y }))),
	};
}

/** The MVT feature type (1 point, 2 line, 3 polygon) of an MLT geometry type. */
function featureType(type: GEOMETRY_TYPE): TileFeature['type'] {
	switch (type) {
		case GEOMETRY_TYPE.POINT:
		case GEOMETRY_TYPE.MULTIPOINT:
			return 1;
		case GEOMETRY_TYPE.LINESTRING:
		case GEOMETRY_TYPE.MULTILINESTRING:
			return 2;
		case GEOMETRY_TYPE.POLYGON:
		case GEOMETRY_TYPE.MULTIPOLYGON:
			return 3;
		default:
			return 0;
	}
}
