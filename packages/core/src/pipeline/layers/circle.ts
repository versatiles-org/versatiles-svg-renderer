import type { Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import type { Renderer } from '../../renderer/svg.js';
import {
	evaluateLayer,
	filterFeatures,
	getFeatures,
	screenTranslate,
	sortByKey,
	type Layer,
} from './layer.js';

export function renderCircleLayer(layer: Layer): void {
	// A circle at each point, and at each vertex of lines and polygons, as in MapLibre.
	const features = getFeatures(layer.sourceFeatures, layer.layerStyle);
	const points = features && [...features.points, ...(features.vertices ?? [])];
	if (!points || points.length === 0) return;
	const pointFeatures = filterFeatures(layer, points);
	if (pointFeatures.length === 0) return;

	const { getPaint, getLayout } = evaluateLayer(layer);
	const sorted = sortByKey(pointFeatures, (feature) => getLayout('circle-sort-key', feature));
	const styled = sorted.map((feature): Parameters<Renderer['drawCircles']>[1][number] => [
		feature,
		{
			color: getPaint('circle-color', feature) as MaplibreColor,
			opacity: getPaint('circle-opacity', feature) as number,
			radius: getPaint('circle-radius', feature) as number,
			translate: screenTranslate(
				layer.job,
				getPaint('circle-translate', feature),
				getPaint('circle-translate-anchor', feature),
			),
			strokeWidth: getPaint('circle-stroke-width', feature) as number,
			strokeColor: getPaint('circle-stroke-color', feature) as MaplibreColor,
			strokeOpacity: getPaint('circle-stroke-opacity', feature) as number,
			blur: getPaint('circle-blur', feature) as number,
		},
	]);
	layer.job.renderer.drawCircles(layer.layerStyle.id, styled);
}
