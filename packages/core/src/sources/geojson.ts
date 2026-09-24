import type { GeoJSON, Geometry } from 'geojson';
import { Point2D, Feature, GEOJSON_LAYER, viewArea } from '../geometry.js';
import type { Features, LayerFeatures } from '../geometry.js';
import type { Projection } from '../projection.js';

type Coord = [number, number];

export interface GeoJSONLoadOptions {
	data: GeoJSON;
	width: number;
	height: number;
	zoom: number;
	center: [number, number];
	layerFeatures: LayerFeatures;
	projection?: Projection;
}

export function loadGeoJSONSource(options: GeoJSONLoadOptions): void {
	const { data, width, height, zoom, center, layerFeatures, projection } = options;
	const existing = layerFeatures.get(GEOJSON_LAYER);
	const features: Features = existing ?? {
		points: [],
		linestrings: [],
		polygons: [],
		polygonOutlines: [],
	};
	features.polygonOutlines ??= [];
	if (!existing) layerFeatures.set(GEOJSON_LAYER, features);

	const worldSize = 512 * 2 ** zoom;
	const centerMercator = new Point2D(center[0], center[1]).getProject2Pixel();

	function toMercator(coord: Coord): Coord {
		const mercator = new Point2D(coord[0], coord[1]).getProject2Pixel();
		return [mercator.x, mercator.y];
	}

	function project(type: 'LineString' | 'Point' | 'Polygon', rings: Coord[][]): Point2D[][] {
		if (projection?.isGlobe) {
			if (type === 'Polygon') rings = orientRings(rings);
			return projection.projectGeometry(type, rings);
		}
		const moved = projection?.isTransformed ? projection : undefined;
		return rings.map((ring) =>
			ring.map(([x, y]) => {
				const px = (x - centerMercator.x) * worldSize + width / 2;
				const py = (y - centerMercator.y) * worldSize + height / 2;
				return moved ? moved.fromNorthUp(px, py) : new Point2D(px, py);
			}),
		);
	}

	function makeFeature(
		type: 'LineString' | 'Point' | 'Polygon',
		geometry: Point2D[][],
		id: unknown,
		properties: Record<string, unknown>,
	): Feature | null {
		const feature = new Feature({ type, geometry, id, properties });
		if (!feature.doesOverlap(viewArea(width, height))) return null;
		return feature;
	}

	function extractPoints(geometry: Point2D[][]): Point2D[][] {
		return geometry.flatMap((ring) => ring.map((p) => [p]));
	}

	function addFeature(
		type: 'LineString' | 'Point' | 'Polygon',
		rings: Coord[][],
		id: unknown,
		properties: Record<string, unknown>,
	): void {
		const geometry = project(type, rings);
		if (geometry.length === 0) return;
		switch (type) {
			case 'Point': {
				const f = makeFeature('Point', geometry, id, properties);
				if (f) features.points.push(f);
				break;
			}
			case 'LineString': {
				const f = makeFeature('LineString', geometry, id, properties);
				if (f) {
					features.linestrings.push(f);
					features.points.push(
						new Feature({ type: 'Point', geometry: extractPoints(geometry), id, properties }),
					);
				}
				break;
			}
			case 'Polygon': {
				geometry.forEach((ring, ringIndex) => {
					const needsCW = ringIndex === 0;

					let area = 0;
					for (let i = 0; i < ring.length; i++) {
						const j = (i + 1) % ring.length;
						area += ring[i]!.x * ring[j]!.y;
						area -= ring[j]!.x * ring[i]!.y;
					}

					if (area < 0 !== needsCW) ring.reverse();
				});
				const f = makeFeature('Polygon', geometry, id, properties);
				if (f) {
					features.polygons.push(f);
					// Stroke source for `line` layers only — NOT `fill` (the polygon is
					// already filled via features.polygons; filling this too would double it).
					// A polygon, as in MapLibre: its rings are closed, and `geometry-type` says so.
					features.polygonOutlines!.push(
						new Feature({ type: 'Polygon', geometry, id, properties }),
					);
					features.points.push(
						new Feature({ type: 'Point', geometry: extractPoints(geometry), id, properties }),
					);
				}
				break;
			}
		}
	}

	function processGeometry(
		geom: Geometry,
		id: string | number | undefined,
		properties: Record<string, unknown>,
	): void {
		switch (geom.type) {
			case 'Point':
				addFeature('Point', [[toMercator(geom.coordinates as Coord)]], id, properties);
				break;
			case 'MultiPoint':
				addFeature(
					'Point',
					geom.coordinates.map((c) => [toMercator(c as Coord)]),
					id,
					properties,
				);
				break;
			case 'LineString':
				addFeature(
					'LineString',
					[geom.coordinates.map((c) => toMercator(c as Coord))],
					id,
					properties,
				);
				break;
			case 'MultiLineString':
				addFeature(
					'LineString',
					geom.coordinates.map((line) => line.map((c) => toMercator(c as Coord))),
					id,
					properties,
				);
				break;
			case 'Polygon':
				addFeature(
					'Polygon',
					geom.coordinates.map((ring) => ring.map((c) => toMercator(c as Coord))),
					id,
					properties,
				);
				break;
			case 'MultiPolygon':
				for (const polygon of geom.coordinates) {
					addFeature(
						'Polygon',
						polygon.map((ring) => ring.map((c) => toMercator(c as Coord))),
						id,
						properties,
					);
				}
				break;
			case 'GeometryCollection':
				for (const g of geom.geometries) {
					processGeometry(g, id, properties);
				}
				break;
		}
	}

	switch (data.type) {
		case 'FeatureCollection':
			for (const f of data.features) {
				processGeometry(f.geometry, f.id, f.properties ?? {});
			}
			break;
		case 'Feature':
			processGeometry(data.geometry, data.id, data.properties ?? {});
			break;
		default:
			processGeometry(data, undefined, {});
			break;
	}
}

/**
 * Orients polygon rings like vector tiles do (in mercator space, y pointing south: the
 * exterior ring clockwise, holes counter-clockwise), as the globe clipping relies on it.
 */
function orientRings(rings: Coord[][]): Coord[][] {
	return rings.map((ring, index) => {
		let area = 0;
		for (let i = 0; i < ring.length; i++) {
			const [x0, y0] = ring[i]!;
			const [x1, y1] = ring[(i + 1) % ring.length]!;
			area += x0 * y1 - x1 * y0;
		}
		const isExterior = index === 0;
		return area > 0 === isExterior ? ring : [...ring].reverse();
	});
}
