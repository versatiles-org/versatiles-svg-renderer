import type { Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import type { Renderer } from '../../renderer/svg.js';
import {
	evaluateLayer,
	filterFeatures,
	getFeatures,
	resolvePattern,
	screenTranslate,
	sortByKey,
	type Layer,
} from './layer.js';

export async function renderFillLayer(layer: Layer): Promise<void> {
	// MapLibre's fill layer also fills LineString features (auto-closing the ring), so
	// include linestrings alongside polygons for parity. drawPolygons closes every subpath,
	// so a linestring is filled as a closed ring.
	const features = getFeatures(layer.sourceFeatures, layer.layerStyle);
	const fillable = [...(features?.polygons ?? []), ...(features?.linestrings ?? [])];
	if (fillable.length === 0) return;
	const polygonFeatures = filterFeatures(layer, fillable);
	if (polygonFeatures.length === 0) return;

	const { getPaint, getLayout } = evaluateLayer(layer);
	const sorted = sortByKey(polygonFeatures, (feature) => getLayout('fill-sort-key', feature));
	const styled = sorted.flatMap((feature): Parameters<Renderer['drawPolygons']>[1] => {
		const pattern = resolvePattern(layer, getPaint('fill-pattern', feature));
		// A pattern whose image is not in the sprite draws nothing, as in MapLibre.
		if (pattern === null) return [];
		return [
			[
				feature,
				{
					color: getPaint('fill-color', feature) as MaplibreColor,
					opacity: getPaint('fill-opacity', feature) as number,
					pattern,
					translate: screenTranslate(
						layer.job,
						getPaint('fill-translate', feature),
						getPaint('fill-translate-anchor', feature),
					),
					// fill-outline-color has no default (stays undefined when unset); the renderer only
					// draws an outline when a distinct color is given.
					outlineColor: getPaint('fill-outline-color', feature) as MaplibreColor | undefined,
					// fill-antialias defaults to true (data-constant).
					antialias: getPaint('fill-antialias') as boolean,
				},
			],
		];
	});
	await layer.job.renderer.drawPolygons(layer.layerStyle.id, styled);
}
