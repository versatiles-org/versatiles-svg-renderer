import { type Feature, type Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import { getLayerFeatures, getRasterTiles } from '../sources/index.js';
import { loadSpriteAtlas } from '../sources/sprite.js';
import type { SpriteAtlas } from '../sources/sprite.js';
import { getLayerStyles } from './style_layer.js';
import type { PossiblyEvaluatedPropertyValue, StyleLayer } from './style_layer.js';
import type { RenderJob } from '../renderer/svg.js';
import type { Features, LayerFeatures } from '../geometry.js';

function resolveTokens(text: string, properties: Record<string, unknown>): string {
	return text.replace(/\{([^}]+)\}/g, (_, key: string) => {
		const value = properties[key];
		if (value == null) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		return '';
	});
}

export async function renderMap(job: RenderJob): Promise<string> {
	await render(job);
	return job.renderer.getString();
}

function getFeatures(layerFeatures: LayerFeatures, layerStyle: StyleLayer): Features | undefined {
	return layerFeatures.get(layerStyle.sourceLayer) ?? layerFeatures.get(layerStyle.source);
}

async function render(job: RenderJob): Promise<void> {
	const { renderer } = job;
	const { zoom } = job.view;
	const [layerFeatures, spriteAtlas] = await Promise.all([
		getLayerFeatures(job),
		job.renderLabels ? loadSpriteAtlas(job.style) : Promise.resolve(new Map() as SpriteAtlas),
	]);
	const layerStyles = getLayerStyles(job.style.layers);
	const availableImages: string[] = [...spriteAtlas.keys()];
	const featureState = {};

	for (const layerStyle of layerStyles) {
		if (layerStyle.isHidden(zoom)) continue;

		layerStyle.recalculate({ zoom }, availableImages);

		function getStyleValue(obj: unknown, key: string, feature?: Feature): unknown {
			const getter = obj as { get(k: string): unknown };
			const value = getter.get(key);
			if (typeof value === 'object' && value !== null && 'evaluate' in value) {
				const evaluatable = value as PossiblyEvaluatedPropertyValue<unknown>;
				return evaluatable.evaluate(
					feature ?? ({} as Feature),
					featureState,
					undefined,
					availableImages,
				);
			}
			return value;
		}

		function getPaint(key: string, feature?: Feature): unknown {
			return getStyleValue(layerStyle.paint, key, feature);
		}

		function getLayout(key: string, feature?: Feature): unknown {
			return getStyleValue(layerStyle.layout, key, feature);
		}

		const layerId = layerStyle.id;

		switch (layerStyle.type) {
			case 'background':
				{
					renderer.drawBackgroundFill({
						color: getPaint('background-color') as MaplibreColor,
						opacity: getPaint('background-opacity') as number,
					});
				}
				continue;
			case 'fill':
				{
					// MapLibre's fill layer also fills LineString features (auto-closing the
					// ring), so include linestrings alongside polygons for parity. drawPolygons
					// closes every subpath, so a linestring is filled as a closed ring.
					const fillFeatures = getFeatures(layerFeatures, layerStyle);
					const fillable = [
						...(fillFeatures?.polygons ?? []),
						...(fillFeatures?.linestrings ?? []),
					];
					if (fillable.length === 0) continue;
					const polygonFeatures = layerStyle.filterFn
						? fillable.filter((feature) => layerStyle.filterFn!.filter({ zoom }, feature))
						: fillable;

					if (polygonFeatures.length === 0) continue;

					renderer.drawPolygons(
						layerId,
						polygonFeatures.map((feature) => [
							feature,
							{
								color: getPaint('fill-color', feature) as MaplibreColor,
								opacity: getPaint('fill-opacity', feature) as number,
								translate: getPaint('fill-translate', feature) as [number, number],
								// fill-outline-color has no default (stays undefined when unset); the
								// renderer only draws an outline when a distinct color is given.
								outlineColor: getPaint('fill-outline-color', feature) as MaplibreColor | undefined,
								// fill-antialias defaults to true (data-constant).
								antialias: getPaint('fill-antialias') as boolean,
							},
						]),
					);
				}
				continue;
			case 'line':
				{
					// Stroke real linestrings plus polygon boundaries (MapLibre draws polygon
					// rings in a line layer). polygonOutlines is kept out of `fill` so polygons
					// are not filled a second time.
					const lineFeats = getFeatures(layerFeatures, layerStyle);
					const lineStrings = [
						...(lineFeats?.linestrings ?? []),
						...(lineFeats?.polygonOutlines ?? []),
					];
					if (lineStrings.length === 0) continue;
					const lineStringFeatures = layerStyle.filterFn
						? lineStrings.filter((feature) => layerStyle.filterFn!.filter({ zoom }, feature))
						: lineStrings;

					if (lineStringFeatures.length === 0) continue;

					renderer.drawLineStrings(
						layerId,
						lineStringFeatures.map((feature) => [
							feature,
							{
								blur: getPaint('line-blur', feature) as number,
								color: getPaint('line-color', feature) as MaplibreColor,
								translate: getPaint('line-translate', feature) as [number, number],
								cap: getLayout('line-cap', feature) as 'butt' | 'round' | 'square',
								dasharray: getPaint('line-dasharray', feature) as number[] | undefined,
								join: getLayout('line-join', feature) as 'bevel' | 'miter' | 'round',
								miterLimit: getLayout('line-miter-limit', feature) as number,
								offset: getPaint('line-offset', feature) as number,
								opacity: getPaint('line-opacity', feature) as number,
								width: getPaint('line-width', feature) as number,
							},
						]),
					);
				}
				continue;
			case 'raster':
				{
					const tiles = await getRasterTiles(job, layerStyle.source);
					renderer.drawRasterTiles(layerId, tiles, {
						opacity: getPaint('raster-opacity') as number,
						hueRotate: getPaint('raster-hue-rotate') as number,
						brightnessMin: getPaint('raster-brightness-min') as number,
						brightnessMax: getPaint('raster-brightness-max') as number,
						saturation: getPaint('raster-saturation') as number,
						contrast: getPaint('raster-contrast') as number,
						resampling: getPaint('raster-resampling') as 'linear' | 'nearest',
					});
				}
				continue;
			case 'circle':
				{
					const points = getFeatures(layerFeatures, layerStyle)?.points;
					if (!points || points.length === 0) continue;
					const pointFeatures = layerStyle.filterFn
						? points.filter((feature) => layerStyle.filterFn!.filter({ zoom }, feature))
						: points;

					if (pointFeatures.length === 0) continue;

					renderer.drawCircles(
						layerId,
						pointFeatures.map((feature) => [
							feature,
							{
								color: getPaint('circle-color', feature) as MaplibreColor,
								opacity: getPaint('circle-opacity', feature) as number,
								radius: getPaint('circle-radius', feature) as number,
								translate: getPaint('circle-translate', feature) as [number, number],
								strokeWidth: getPaint('circle-stroke-width', feature) as number,
								strokeColor: getPaint('circle-stroke-color', feature) as MaplibreColor,
							},
						]),
					);
				}
				continue;
			case 'symbol':
				{
					if (!job.renderLabels) continue;
					const features = getFeatures(layerFeatures, layerStyle);
					const allFeatures = [
						...(features?.points ?? []),
						...(features?.linestrings ?? []),
						...(features?.polygons ?? []),
					];
					if (allFeatures.length === 0) continue;
					const symbolFeatures = layerStyle.filterFn
						? allFeatures.filter((feature) => layerStyle.filterFn!.filter({ zoom }, feature))
						: allFeatures;

					if (symbolFeatures.length === 0) continue;

					// Render icons first (underneath text)
					renderer.drawIcons(
						`${layerId}-icons`,
						symbolFeatures.flatMap((feature) => {
							const iconImage = getLayout('icon-image', feature);
							const iconName =
								iconImage != null
									? resolveTokens(
											(iconImage as { toString(): string }).toString(),
											feature.properties,
										)
									: '';
							if (!iconName || !spriteAtlas.has(iconName)) return [];
							const spriteEntry = spriteAtlas.get(iconName)!;
							return [
								[
									feature,
									{
										image: iconName,
										size: getLayout('icon-size', feature) as number,
										anchor: getLayout('icon-anchor', feature) as string,
										offset: getLayout('icon-offset', feature) as [number, number],
										rotate: getLayout('icon-rotate', feature) as number,
										opacity: getPaint('icon-opacity', feature) as number,
										sdf: spriteEntry.sdf,
										color: getPaint('icon-color', feature) as MaplibreColor,
										haloColor: getPaint('icon-halo-color', feature) as MaplibreColor,
										haloWidth: getPaint('icon-halo-width', feature) as number,
									},
								],
							];
						}),
						spriteAtlas,
					);

					// Render text labels on top
					renderer.drawLabels(
						`${layerId}-labels`,
						symbolFeatures.flatMap((feature) => {
							const textField = getLayout('text-field', feature);
							const textRaw =
								textField != null ? (textField as { toString(): string }).toString() : '';
							const text = resolveTokens(textRaw, feature.properties);
							if (!text) return [];
							return [
								[
									feature,
									{
										text,
										size: getLayout('text-size', feature) as number,
										font: getLayout('text-font', feature) as string[],
										anchor: getLayout('text-anchor', feature) as string,
										offset: getLayout('text-offset', feature) as [number, number],
										rotate: getLayout('text-rotate', feature) as number,
										color: getPaint('text-color', feature) as MaplibreColor,
										opacity: getPaint('text-opacity', feature) as number,
										haloColor: getPaint('text-halo-color', feature) as MaplibreColor,
										haloWidth: getPaint('text-halo-width', feature) as number,
									},
								],
							];
						}),
					);
				}
				continue;
			case 'color-relief':
			case 'fill-extrusion':
			case 'heatmap':
			case 'hillshade':
				continue;
			default:
				throw Error('layerStyle.type: ' + String(layerStyle.type));
		}
	}
}
