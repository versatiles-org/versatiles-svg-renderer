/**
 * Converts an MVT vector tile to MLT (MapLibre Tile), keeping its layers, features, ids,
 * properties and geometry, so a region can draw the same tiles in both encodings.
 */
import { classifyRings, VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { encodeTile, type FeatureGeometry, type Layer, type Position } from '@maplibre/mlt';
import { PbfReader } from 'pbf';

export function mvtToMLT(buffer: ArrayBuffer | Uint8Array): Uint8Array {
	const tile = new VectorTile(new PbfReader(buffer));
	const layers: Layer[] = Object.values(tile.layers).map((layer) => ({
		name: layer.name,
		extent: layer.extent,
		features: Array.from({ length: layer.length }, (_, i) => {
			const feature = layer.feature(i);
			return {
				...(feature.id === undefined ? {} : { id: feature.id }),
				geometry: toGeometry(feature),
				properties: feature.properties,
			};
		}),
	}));
	return encodeTile(layers);
}

/** The feature's geometry, as GeoJSON nests it: polygons with their holes, without closing positions. */
function toGeometry(feature: VectorTileFeature): FeatureGeometry {
	const rings = feature.loadGeometry();
	const position = ({ x, y }: { x: number; y: number }): Position => [x, y];
	switch (feature.type) {
		case 1: {
			const points = rings.flat().map(position);
			return points.length === 1
				? { type: 'Point', coordinates: points[0]! }
				: { type: 'MultiPoint', coordinates: points };
		}
		case 2: {
			const lines = rings.map((ring) => ring.map(position));
			return lines.length === 1
				? { type: 'LineString', coordinates: lines[0]! }
				: { type: 'MultiLineString', coordinates: lines };
		}
		case 3: {
			const polygons = classifyRings(rings).map((polygon) =>
				polygon.map((ring) => ring.slice(0, -1).map(position)),
			);
			return polygons.length === 1
				? { type: 'Polygon', coordinates: polygons[0]! }
				: { type: 'MultiPolygon', coordinates: polygons };
		}
		default:
			throw new Error(`Unknown feature type ${String(feature.type)}`);
	}
}
