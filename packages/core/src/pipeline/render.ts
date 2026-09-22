import { type Feature, type Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import { getLayerFeatures, getRasterTiles } from '../sources/index.js';
import { loadSpriteAtlas } from '../sources/sprite.js';
import type { SpriteAtlas } from '../sources/sprite.js';
import { getTile, type TileLoader } from '../sources/tiles.js';
import { defaultFetch, type FetchFunction } from '../sources/fetch.js';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { getLayerStyles } from './style_layer.js';
import type {
	EvaluatedProperties,
	PossiblyEvaluatedPropertyValue,
	StyleLayer,
} from './style_layer.js';
import type { RenderJob, Renderer, StringRenderer } from '../renderer/svg.js';
import type { Feature as LayerFeature, Features, LayerFeatures } from '../geometry.js';
import { Projection } from '../projection.js';

function resolveTokens(text: string, properties: Record<string, unknown>): string {
	return text.replace(/\{([^}]+)\}/g, (_, key: string) => {
		const value = properties[key];
		if (value == null) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		return '';
	});
}

/**
 * What rendering needs from a style besides the view: prepared once per style, so that
 * rendering many views of one style does not redo it. Shared by concurrent renders, so
 * nothing in it may depend on a view.
 */
export interface RenderContext {
	/** The style's layers, parsed. */
	layers: StyleLayer[];
	/** The style's sprite atlas. Only called when labels are rendered. */
	getSprite(): Promise<SpriteAtlas>;
	loadTile: TileLoader;
}

/** A context without any caching, for rendering a single view. */
export function createRenderContext(
	style: StyleSpecification,
	fetchFn: FetchFunction = defaultFetch,
): RenderContext {
	return {
		layers: getLayerStyles(style.layers),
		getSprite: () => loadSpriteAtlas(style, fetchFn),
		loadTile: (url, z, x, y) => getTile(url, z, x, y, fetchFn),
	};
}

/**
 * Draws the map described by `job` onto its renderer and returns that renderer, so a
 * caller can take the result in whatever form the backend provides (see
 * {@link renderMap} for the SVG string, or `renderToPNG` in `@versatiles/png-renderer` for
 * an image buffer).
 *
 * `context` must have been created for `job.style`; without one, a fresh one is made.
 */
export async function drawMap<R extends Renderer>(
	job: RenderJob<R>,
	context: RenderContext = createRenderContext(job.style),
): Promise<R> {
	job.projection ??= Projection.fromStyle({
		width: job.renderer.width,
		height: job.renderer.height,
		center: job.view.center,
		zoom: job.view.zoom,
		projection: job.style.projection,
	});
	const clipCircle = job.projection.clipCircle;
	if (clipCircle) job.renderer.setClipCircle?.(clipCircle);
	await render(job, context);
	return job.renderer;
}

export async function renderMap(
	job: RenderJob<StringRenderer>,
	context?: RenderContext,
): Promise<string> {
	return (await drawMap(job, context)).getString();
}

function getFeatures(layerFeatures: LayerFeatures, layerStyle: StyleLayer): Features | undefined {
	return layerFeatures.get(layerStyle.sourceLayer) ?? layerFeatures.get(layerStyle.source);
}

async function render(job: RenderJob, context: RenderContext): Promise<void> {
	const [layerFeatures, spriteAtlas] = await Promise.all([
		getLayerFeatures(job, context.loadTile),
		job.renderLabels ? context.getSprite() : Promise.resolve(new Map() as SpriteAtlas),
	]);
	const availableImages: string[] = [...spriteAtlas.keys()];

	for (const layerStyle of context.layers) {
		if (layerStyle.isHidden(job.view.zoom)) continue;

		// One function per layer type. Besides keeping each short, this lets a CPU profile
		// tell the layer types apart: `npm run bench` divides the time by these functions.
		const layer: Layer = { job, context, layerStyle, layerFeatures, spriteAtlas, availableImages };
		switch (layerStyle.type) {
			case 'background':
				renderBackgroundLayer(layer);
				continue;
			case 'fill':
				renderFillLayer(layer);
				continue;
			case 'line':
				renderLineLayer(layer);
				continue;
			case 'raster':
				await renderRasterLayer(layer);
				continue;
			case 'circle':
				renderCircleLayer(layer);
				continue;
			case 'symbol':
				await renderSymbolLayer(layer);
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

/** One layer to draw, with what the render has loaded for it. */
interface Layer {
	job: RenderJob;
	context: RenderContext;
	layerStyle: StyleLayer;
	layerFeatures: LayerFeatures;
	spriteAtlas: SpriteAtlas;
	availableImages: string[];
}

/** A layer's paint and layout values at the render's zoom, per feature where data-driven. */
interface LayerValues {
	getPaint: (key: string, feature?: LayerFeature) => unknown;
	getLayout: (key: string, feature?: LayerFeature) => unknown;
}

function evaluateLayer(layer: Layer): LayerValues {
	const { layerStyle, availableImages } = layer;
	const { paint, layout } = layerStyle.evaluate({ zoom: layer.job.view.zoom }, availableImages);
	const featureState = {};

	function getStyleValue(
		properties: EvaluatedProperties,
		key: string,
		feature?: LayerFeature,
	): unknown {
		const value = properties.get(key);
		if (typeof value === 'object' && value !== null && 'evaluate' in value) {
			const evaluatable = value as PossiblyEvaluatedPropertyValue<unknown>;
			return evaluatable.evaluate(
				(feature ?? {}) as Feature,
				featureState,
				undefined,
				availableImages,
			);
		}
		return value;
	}

	function getPaint(key: string, feature?: LayerFeature): unknown {
		return getStyleValue(paint, key, feature);
	}

	function getLayout(key: string, feature?: LayerFeature): unknown {
		return getStyleValue(layout, key, feature);
	}

	return { getPaint, getLayout };
}

/** The features that pass the layer's filter. */
function filterFeatures(layer: Layer, features: LayerFeature[]): LayerFeature[] {
	const { filterFn } = layer.layerStyle;
	if (!filterFn) return features;
	const globals = { zoom: layer.job.view.zoom };
	return features.filter((feature) => filterFn.filter(globals, feature));
}

function renderBackgroundLayer(layer: Layer): void {
	const { getPaint } = evaluateLayer(layer);
	layer.job.renderer.drawBackgroundFill({
		color: getPaint('background-color') as MaplibreColor,
		opacity: getPaint('background-opacity') as number,
	});
}

function renderFillLayer(layer: Layer): void {
	// MapLibre's fill layer also fills LineString features (auto-closing the ring), so
	// include linestrings alongside polygons for parity. drawPolygons closes every subpath,
	// so a linestring is filled as a closed ring.
	const features = getFeatures(layer.layerFeatures, layer.layerStyle);
	const fillable = [...(features?.polygons ?? []), ...(features?.linestrings ?? [])];
	if (fillable.length === 0) return;
	const polygonFeatures = filterFeatures(layer, fillable);
	if (polygonFeatures.length === 0) return;

	const { getPaint } = evaluateLayer(layer);
	const styled = polygonFeatures.map((feature): Parameters<Renderer['drawPolygons']>[1][number] => [
		feature,
		{
			color: getPaint('fill-color', feature) as MaplibreColor,
			opacity: getPaint('fill-opacity', feature) as number,
			translate: getPaint('fill-translate', feature) as [number, number],
			// fill-outline-color has no default (stays undefined when unset); the renderer only
			// draws an outline when a distinct color is given.
			outlineColor: getPaint('fill-outline-color', feature) as MaplibreColor | undefined,
			// fill-antialias defaults to true (data-constant).
			antialias: getPaint('fill-antialias') as boolean,
		},
	]);
	layer.job.renderer.drawPolygons(layer.layerStyle.id, styled);
}

function renderLineLayer(layer: Layer): void {
	// Stroke real linestrings plus polygon boundaries (MapLibre draws polygon rings in a
	// line layer). polygonOutlines is kept out of `fill` so polygons are not filled a
	// second time.
	const features = getFeatures(layer.layerFeatures, layer.layerStyle);
	const lineStrings = [...(features?.linestrings ?? []), ...(features?.polygonOutlines ?? [])];
	if (lineStrings.length === 0) return;
	const lineStringFeatures = filterFeatures(layer, lineStrings);
	if (lineStringFeatures.length === 0) return;

	const { getPaint, getLayout } = evaluateLayer(layer);
	const styled = lineStringFeatures.map(
		(feature): Parameters<Renderer['drawLineStrings']>[1][number] => [
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
		],
	);
	layer.job.renderer.drawLineStrings(layer.layerStyle.id, styled);
}

async function renderRasterLayer(layer: Layer): Promise<void> {
	const { job, context, layerStyle } = layer;
	const tiles = await getRasterTiles(job, layerStyle.source, context.loadTile);
	const { getPaint } = evaluateLayer(layer);
	await job.renderer.drawRasterTiles(layerStyle.id, tiles, {
		opacity: getPaint('raster-opacity') as number,
		hueRotate: getPaint('raster-hue-rotate') as number,
		brightnessMin: getPaint('raster-brightness-min') as number,
		brightnessMax: getPaint('raster-brightness-max') as number,
		saturation: getPaint('raster-saturation') as number,
		contrast: getPaint('raster-contrast') as number,
		resampling: getPaint('raster-resampling') as 'linear' | 'nearest',
	});
}

function renderCircleLayer(layer: Layer): void {
	const points = getFeatures(layer.layerFeatures, layer.layerStyle)?.points;
	if (!points || points.length === 0) return;
	const pointFeatures = filterFeatures(layer, points);
	if (pointFeatures.length === 0) return;

	const { getPaint } = evaluateLayer(layer);
	const styled = pointFeatures.map((feature): Parameters<Renderer['drawCircles']>[1][number] => [
		feature,
		{
			color: getPaint('circle-color', feature) as MaplibreColor,
			opacity: getPaint('circle-opacity', feature) as number,
			radius: getPaint('circle-radius', feature) as number,
			translate: getPaint('circle-translate', feature) as [number, number],
			strokeWidth: getPaint('circle-stroke-width', feature) as number,
			strokeColor: getPaint('circle-stroke-color', feature) as MaplibreColor,
		},
	]);
	layer.job.renderer.drawCircles(layer.layerStyle.id, styled);
}

async function renderSymbolLayer(layer: Layer): Promise<void> {
	const { job, layerStyle, spriteAtlas } = layer;
	if (!job.renderLabels) return;
	const features = getFeatures(layer.layerFeatures, layerStyle);
	const allFeatures = [
		...(features?.points ?? []),
		...(features?.linestrings ?? []),
		...(features?.polygons ?? []),
	];
	if (allFeatures.length === 0) return;
	const symbolFeatures = filterFeatures(layer, allFeatures);
	if (symbolFeatures.length === 0) return;

	const { getPaint, getLayout } = evaluateLayer(layer);
	const icons = symbolFeatures.flatMap((feature): Parameters<Renderer['drawIcons']>[1] => {
		const iconImage = getLayout('icon-image', feature);
		const iconName =
			iconImage != null
				? resolveTokens((iconImage as { toString(): string }).toString(), feature.properties)
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
	});
	const labels = symbolFeatures.flatMap((feature): Parameters<Renderer['drawLabels']>[1] => {
		const textField = getLayout('text-field', feature);
		const textRaw = textField != null ? (textField as { toString(): string }).toString() : '';
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
	});

	// Icons first, underneath the text.
	await job.renderer.drawIcons(`${layerStyle.id}-icons`, icons, spriteAtlas);
	job.renderer.drawLabels(`${layerStyle.id}-labels`, labels);
}
