import type { Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import { Feature as LayerFeature, Point2D } from '../../geometry.js';
import { patternPeriod } from '../../renderer/line_pattern.js';
import type { LineStyle, Renderer } from '../../types.js';
import { gapBands } from './line_gap.js';
import {
	evaluateLayer,
	filterFeatures,
	getFeatures,
	resolvePattern,
	screenTranslate,
	sortByKey,
	type Layer,
} from './layer.js';

export async function renderLineLayer(layer: Layer): Promise<void> {
	// Stroke real linestrings plus polygon boundaries (MapLibre draws polygon rings in a
	// line layer). polygonOutlines is kept out of `fill` so polygons are not filled a
	// second time.
	const features = getFeatures(layer.sourceFeatures, layer.layerStyle);
	const lineStrings = [...(features?.linestrings ?? []), ...(features?.polygonOutlines ?? [])];
	if (lineStrings.length === 0) return;
	const lineStringFeatures = filterFeatures(layer, lineStrings);
	if (lineStringFeatures.length === 0) return;

	const { getPaint, getLayout } = evaluateLayer(layer);
	// A pattern is scaled to the line's width at the zoom level's integer part, as in MapLibre.
	const { zoom } = layer.job.view;
	const atFloorZoom = layer.layerStyle.usesPattern
		? evaluateLayer(layer, Math.floor(zoom))
		: undefined;
	const sorted = sortByKey(lineStringFeatures, (feature) => getLayout('line-sort-key', feature));
	const styled = sorted.flatMap((feature): Parameters<Renderer['drawLineStrings']>[1] => {
		const found = resolvePattern(layer, getPaint('line-pattern', feature));
		// A pattern whose image is not in the sprite draws nothing, as in MapLibre.
		if (found === null) return [];
		const style: LineStyle = {
			blur: getPaint('line-blur', feature) as number,
			color: getPaint('line-color', feature) as MaplibreColor,
			translate: screenTranslate(
				layer.job,
				getPaint('line-translate', feature),
				getPaint('line-translate-anchor', feature),
			),
			cap: getLayout('line-cap', feature) as 'butt' | 'round' | 'square',
			dasharray: getPaint('line-dasharray', feature) as number[] | undefined,
			join: getLayout('line-join', feature) as 'bevel' | 'miter' | 'round',
			miterLimit: getLayout('line-miter-limit', feature) as number,
			offset: getPaint('line-offset', feature) as number,
			opacity: getPaint('line-opacity', feature) as number,
			width: getPaint('line-width', feature) as number,
		};
		if (found) {
			const { sprite } = found;
			const floorWidth =
				(atFloorZoom?.getPaint('line-width', feature) as number | undefined) ?? style.width;
			style.pattern = {
				name: found.name,
				sprite,
				period: patternPeriod(
					sprite.width / sprite.pixelRatio,
					sprite.height / sprite.pixelRatio,
					floorWidth,
					zoom,
				),
			};
		}
		const gapWidth = getPaint('line-gap-width', feature) as number;
		if (!(gapWidth > 0)) return [[feature, style]];
		// With a gap, MapLibre draws the line as a band on each side of it, from gap/2 to
		// gap/2 + width: lines of the same width along the middle of each band, joined
		// around corners and ends as MapLibre joins them (see `gapBands`).
		const { open, closed } = gapBands(feature.geometry, feature.type === 'Polygon', {
			shift: (gapWidth + style.width) / 2,
			offset: style.offset,
			cap: style.cap,
			join: style.join,
			roundLimit: getLayout('line-round-limit', feature) as number,
		});
		const bandStyle: LineStyle = { ...style, offset: 0, cap: 'butt' };
		const result: [LayerFeature, LineStyle][] = [];
		const addBands = (type: 'LineString' | 'Polygon', geometry: Point2D[][]): void => {
			if (geometry.length === 0) return;
			const bands = new LayerFeature({
				type,
				geometry,
				id: feature.id,
				properties: feature.properties,
			});
			result.push([bands, bandStyle]);
		};
		addBands('LineString', open);
		addBands(
			'Polygon',
			closed.map((ring) => [...ring, ring[0]!]),
		);
		return result;
	});
	await layer.job.renderer.drawLineStrings(layer.layerStyle.id, styled);
}
