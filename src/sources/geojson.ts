import type { GeoJSON, Geometry } from 'geojson';
import { Point2D, Feature } from '../geometry.js';
import type { Features, LayerFeatures } from '../geometry.js';

type Coord = [number, number];

export interface GeoJSONLoadOptions {
	sourceName: string;
	data: GeoJSON;
	width: number;
	height: number;
	zoom: number;
	center: [number, number];
	layerFeatures: LayerFeatures;
}

export function loadGeoJSONSource(options: GeoJSONLoadOptions): void {
	const { sourceName, data, width, height, zoom, center, layerFeatures } = options;
	const existing = layerFeatures.get(sourceName);
	const features: Features = existing ?? {
		points: [],
		linestrings: [],
		polygons: [],
		polygonOutlines: [],
	};
	features.polygonOutlines ??= [];
	if (!existing) layerFeatures.set(sourceName, features);

	const worldSize = 512 * 2 ** zoom;
	const centerMercator = new Point2D(center[0], center[1]).getProject2Pixel();

	function projectCoord(coord: Coord): Point2D {
		const mercator = new Point2D(coord[0], coord[1]).getProject2Pixel();
		return new Point2D(
			(mercator.x - centerMercator.x) * worldSize + width / 2,
			(mercator.y - centerMercator.y) * worldSize + height / 2,
		);
	}

	function makeFeature(
		type: 'LineString' | 'Point' | 'Polygon',
		geometry: Point2D[][],
		id: unknown,
		properties: Record<string, unknown>,
	): Feature | null {
		const feature = new Feature({ type, geometry, id, properties });
		if (!feature.doesOverlap([0, 0, width, height])) return null;
		return feature;
	}

	function extractPoints(geometry: Point2D[][]): Point2D[][] {
		return geometry.flatMap((ring) => ring.map((p) => [p]));
	}

	function addFeature(
		type: 'LineString' | 'Point' | 'Polygon',
		geometry: Point2D[][],
		id: unknown,
		properties: Record<string, unknown>,
	): void {
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
					features.polygonOutlines!.push(
						new Feature({ type: 'LineString', geometry, id, properties }),
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
				addFeature('Point', [[projectCoord(geom.coordinates as Coord)]], id, properties);
				break;
			case 'MultiPoint':
				addFeature(
					'Point',
					geom.coordinates.map((c) => [projectCoord(c as Coord)]),
					id,
					properties,
				);
				break;
			case 'LineString':
				addFeature(
					'LineString',
					[geom.coordinates.map((c) => projectCoord(c as Coord))],
					id,
					properties,
				);
				break;
			case 'MultiLineString':
				addFeature(
					'LineString',
					geom.coordinates.map((line) => line.map((c) => projectCoord(c as Coord))),
					id,
					properties,
				);
				break;
			case 'Polygon':
				addFeature(
					'Polygon',
					geom.coordinates.map((ring) => ring.map((c) => projectCoord(c as Coord))),
					id,
					properties,
				);
				break;
			case 'MultiPolygon':
				for (const polygon of geom.coordinates) {
					addFeature(
						'Polygon',
						polygon.map((ring) => ring.map((c) => projectCoord(c as Coord))),
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
