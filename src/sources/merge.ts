import { union } from '@turf/union';
import type { Polygon, Feature as GeoJsonFeature, Position, MultiPolygon } from 'geojson';
import { Point2D, Feature } from '../geometry.js';

/**
 * Grid to which polygon coordinates are snapped before unioning. Coordinates are
 * in SVG pixel space, so 1/10 px is well below anything visible while collapsing
 * the near-duplicate points (from adjacent tiles) that make polyclip-ts's boolean
 * ops numerically unstable.
 */
const SNAP_PRECISION = 10;

function snap(value: number): number {
	return Math.round(value * SNAP_PRECISION) / SNAP_PRECISION;
}

/**
 * Unions a list of polygon features into one geometry.
 *
 * polyclip-ts (used by @turf/union) has floating-point robustness bugs that can
 * throw "Unable to complete output ring" on valid-but-overlapping input when all
 * features are unioned at once. We union incrementally and swallow per-step
 * failures so a single problematic feature degrades gracefully (it is dropped from
 * the merge) instead of crashing the whole render.
 */
function unionAll(
	features: GeoJsonFeature<Polygon>[],
): GeoJsonFeature<Polygon | MultiPolygon> | null {
	let accumulated: GeoJsonFeature<Polygon | MultiPolygon> | null = features[0] ?? null;
	for (let i = 1; i < features.length; i++) {
		try {
			const next = union({
				type: 'FeatureCollection' as const,
				features: [accumulated!, features[i]!],
			});
			if (next) accumulated = next;
		} catch (error) {
			console.warn(
				`mergePolygonsByFeatureId: skipping a polygon that failed to union: ${String(error)}`,
			);
		}
	}
	return accumulated;
}

function geojsonToFeature(id: number, polygonFeature: GeoJsonFeature<Polygon>): Feature {
	const geometry = polygonFeature.geometry.coordinates.map((ring) => {
		return ring.map((coord: Position) => new Point2D(coord[0] ?? 0, coord[1] ?? 0));
	});
	return new Feature({
		type: 'Polygon',
		geometry,
		id,
		properties: polygonFeature.properties ?? {},
	});
}

export function mergePolygonsByFeatureId(featureList: Feature[]): Feature[] {
	const featuresById = new Map<number, Feature[]>();
	let nextId = -1;
	for (const feature of featureList) {
		const id = typeof feature.id === 'number' ? feature.id : nextId--;
		const features = featuresById.get(id);
		if (features) {
			features.push(feature);
		} else {
			featuresById.set(id, [feature]);
		}
	}

	const mergedFeatures: Feature[] = [];
	for (const [id, features] of featuresById) {
		if (features.length === 1) {
			mergedFeatures.push(features[0]!);
			continue;
		}
		const turfFeatures: GeoJsonFeature<Polygon>[] = [];
		features.forEach((f) => {
			const rings = f.geometry.map((ring) => ring.map((p) => [snap(p.x), snap(p.y)]));
			turfFeatures.push({
				type: 'Feature' as const,
				geometry: {
					type: 'Polygon' as const,
					coordinates: rings,
				},
				properties: f.properties,
			});
		});
		const merged = unionAll(turfFeatures);
		if (merged) {
			if (merged.geometry.type === 'Polygon') {
				const typedMerged = merged as GeoJsonFeature<Polygon>;
				mergedFeatures.push(geojsonToFeature(id, typedMerged));
			} else {
				const typedMerged = merged as GeoJsonFeature<MultiPolygon>;
				for (const polygon of typedMerged.geometry.coordinates) {
					const currentPolygon: GeoJsonFeature<Polygon> = {
						type: 'Feature',
						geometry: {
							type: 'Polygon',
							coordinates: polygon,
						},
						properties: typedMerged.properties,
					};
					mergedFeatures.push(geojsonToFeature(id, currentPolygon));
				}
			}
		}
	}
	return mergedFeatures;
}
