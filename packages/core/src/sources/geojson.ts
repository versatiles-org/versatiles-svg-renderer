import type { GeoJSON, Geometry, Feature as GeoJSONFeature } from 'geojson';
import { createExpression, type FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
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
	/** The source's `filter`, compiled by {@link compileSourceFilter}. */
	filter?: SourceFilter;
	/** The source's `promoteId`: the property that becomes each feature's id. */
	promoteId?: string;
	/** The source's `generateId`: each feature's index becomes its id. */
	generateId?: boolean;
}

/** Whether a feature of a GeoJSON source passes the source's `filter`. */
export type SourceFilter = (feature: GeoJSONFeature) => boolean;

/**
 * The `filter` of a GeoJSON source as a predicate, as MapLibre GL JS compiles it: evaluated
 * once per feature, at zoom 0. `undefined` without a filter. Throws if it is invalid.
 */
export function compileSourceFilter(filter: unknown, sourceName: string): SourceFilter | undefined {
	if (typeof filter !== 'boolean' && !(Array.isArray(filter) && filter.length > 0)) {
		return undefined;
	}
	const compiled = createExpression(filter as FilterSpecification, `sources.${sourceName}.filter`, {
		type: 'boolean',
		'property-type': 'data-driven',
		overridable: false,
		transition: false,
	} as Parameters<typeof createExpression>[2]);
	if (compiled.result === 'error') {
		throw new Error(compiled.value.map((error) => `${error.key}: ${error.message}`).join(', '));
	}
	const expression = compiled.value;
	// The GeoJSON feature itself is evaluated, as in MapLibre GL JS.
	type EvaluationFeature = Parameters<typeof expression.evaluate>[1];
	return (feature) =>
		expression.evaluate({ zoom: 0 }, feature as unknown as EvaluationFeature) === true;
}

/**
 * A feature's id as MapLibre GL JS reads it with `['id']`: taken from the property
 * `promoteId`, or the feature's index with `generateId`, else its own `id` (as geojson-vt
 * does); then a string is read as an integer, as vt-pbf does, and anything but a number
 * is dropped.
 */
function featureId(
	feature: { id?: unknown; properties?: Record<string, unknown> | null },
	index: number | undefined,
	promoteId: string | undefined,
	generateId: boolean | undefined,
): number | undefined {
	let id: unknown;
	if (promoteId !== undefined) id = feature.properties?.[promoteId];
	else if (generateId) id = index ?? 0;
	else id = feature.id;
	if (typeof id === 'string') return parseInt(id, 10);
	if (typeof id === 'number' && !Number.isNaN(id)) return id;
	return undefined;
}

export function loadGeoJSONSource(options: GeoJSONLoadOptions): void {
	const { data, width, height, zoom, center, layerFeatures, projection } = options;
	const { filter, promoteId, generateId } = options;
	const existing = layerFeatures.get(GEOJSON_LAYER);
	const features: Features = existing ?? {
		points: [],
		linestrings: [],
		polygons: [],
		polygonOutlines: [],
		vertices: [],
	};
	features.polygonOutlines ??= [];
	features.vertices ??= [];
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
					features.vertices!.push(
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
					features.vertices!.push(
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
		case 'FeatureCollection': {
			// Filtered first, so generated ids count only the features that pass.
			const features = filter ? data.features.filter((f) => filter(f)) : data.features;
			features.forEach((f, index) => {
				processGeometry(f.geometry, featureId(f, index, promoteId, generateId), f.properties ?? {});
			});
			break;
		}
		case 'Feature':
			// A single feature is not filtered, as in MapLibre GL JS.
			processGeometry(
				data.geometry,
				featureId(data, undefined, promoteId, generateId),
				data.properties ?? {},
			);
			break;
		default:
			// A bare geometry, as a feature without properties.
			processGeometry(data, featureId({}, undefined, promoteId, generateId), {});
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
