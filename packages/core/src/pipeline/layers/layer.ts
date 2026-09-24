import type { Feature } from '@maplibre/maplibre-gl-style-spec';
import { Feature as LayerFeature, GEOJSON_LAYER, Point2D } from '../../geometry.js';
import type { Features, SourceFeatures } from '../../geometry.js';
import type { RenderJob } from '../../renderer/svg.js';
import type { FillPattern } from '../../renderer/types.js';
import type { SpriteAtlas } from '../../sources/sprite.js';
import type { RenderContext } from '../render.js';
import type {
	EvaluatedProperties,
	PossiblyEvaluatedPropertyValue,
	StyleLayer,
} from '../style_layer.js';

export function getFeatures(
	sourceFeatures: SourceFeatures,
	layerStyle: StyleLayer,
): Features | undefined {
	const layerFeatures = sourceFeatures.get(layerStyle.source);
	// GeoJSON sources ignore "source-layer", as in MapLibre.
	return layerFeatures?.get(layerStyle.sourceLayer) ?? layerFeatures?.get(GEOJSON_LAYER);
}

/** One layer to draw, with what the render has loaded for it. */
export interface Layer {
	job: RenderJob;
	context: RenderContext;
	layerStyle: StyleLayer;
	sourceFeatures: SourceFeatures;
	spriteAtlas: SpriteAtlas;
	availableImages: string[];
}

/** A layer's paint and layout values at the render's zoom, per feature where data-driven. */
export interface LayerValues {
	getPaint: (key: string, feature?: LayerFeature) => unknown;
	getLayout: (key: string, feature?: LayerFeature) => unknown;
}

/**
 * `features` in the order MapLibre draws them: by their `*-sort-key`, lowest first, and in
 * source order where the keys are equal. A feature without a key counts as `0`.
 */
export function sortByKey(
	features: LayerFeature[],
	getKey: (feature: LayerFeature) => unknown,
): LayerFeature[] {
	const keys = features.map((feature) => {
		const key = getKey(feature);
		return typeof key === 'number' && !Number.isNaN(key) ? key : 0;
	});
	if (keys.every((key) => key === keys[0])) return features;
	return features
		.map((feature, i) => ({ feature, key: keys[i]! }))
		.sort((a, b) => a.key - b.key)
		.map(({ feature }) => feature);
}

/**
 * A `*-translate` in pixels on screen: with its anchor `"map"` (the default), it turns with
 * the map's bearing; with `"viewport"`, it stays as it is.
 */
export function screenTranslate(
	job: RenderJob,
	translate: unknown,
	anchor: unknown,
): [number, number] {
	const [x, y] = translate as [number, number];
	const bearing = job.projection?.bearing ?? 0;
	if (anchor === 'viewport' || bearing === 0) return [x, y];
	const angle = (bearing * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return [x * cos + y * sin, -x * sin + y * cos];
}

/**
 * With a source's `promoteId`, how paint properties see a feature: MapLibre GL JS gives them
 * the promoted property as it is as the id (`['id']`; a boolean as a number), where filters
 * and layout properties read the tile feature's own id. `undefined` without `promoteId`.
 */
function promotedFeatures(layer: Layer): ((feature: LayerFeature) => LayerFeature) | undefined {
	const { layerStyle, job } = layer;
	const source = job.style.sources[layerStyle.source] as
		{ type: string; promoteId?: unknown } | undefined;
	const promoteId = source?.promoteId;
	if (!source || !promoteId) return undefined;
	const sourceLayer = source.type === 'geojson' ? '_geojsonTileLayer' : layerStyle.sourceLayer;
	const property =
		typeof promoteId === 'string'
			? promoteId
			: (promoteId as Record<string, string | undefined>)[sourceLayer];
	const promoted = new WeakMap<LayerFeature, LayerFeature>();
	return (feature) => {
		let result = promoted.get(feature);
		if (!result) {
			let id = property === undefined ? undefined : feature.properties[property];
			if (typeof id === 'boolean') id = Number(id);
			// What expressions read of a feature, with the promoted id.
			const { type, properties, geometry } = feature;
			result = { type, properties, geometry, id } as LayerFeature;
			promoted.set(feature, result);
		}
		return result;
	};
}

/** The layer's values at the render's zoom, or at `zoom`. */
export function evaluateLayer(layer: Layer, zoom = layer.job.view.zoom): LayerValues {
	const { layerStyle, availableImages } = layer;
	const { paint, layout } = layerStyle.evaluate({ zoom }, availableImages);
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

	const paintFeature = promotedFeatures(layer);

	function getPaint(key: string, feature?: LayerFeature): unknown {
		return getStyleValue(paint, key, feature && paintFeature ? paintFeature(feature) : feature);
	}

	function getLayout(key: string, feature?: LayerFeature): unknown {
		return getStyleValue(layout, key, feature);
	}

	return { getPaint, getLayout };
}

/** The features that pass the layer's filter. */
export function filterFeatures(layer: Layer, features: LayerFeature[]): LayerFeature[] {
	const { filterFn } = layer.layerStyle;
	if (!filterFn) return features;
	const globals = { zoom: layer.job.view.zoom };
	return features.filter((feature) => filterFn.filter(globals, feature));
}

/**
 * The pattern a `*-pattern` value names: `undefined` without one, `null` if its image is
 * not in the sprite.
 */
export function resolvePattern(layer: Layer, value: unknown): FillPattern | null | undefined {
	const name =
		typeof value === 'string'
			? value
			: typeof value === 'object' && value !== null && 'name' in value
				? String(value.name)
				: '';
	if (!name) return undefined;
	const sprite = layer.spriteAtlas.get(name);
	if (!sprite) return null;
	const bearing = layer.job.projection?.bearing ?? 0;
	const { zoom } = layer.job.view;
	const scale = 2 ** (zoom - Math.floor(zoom));
	return {
		name,
		sprite,
		origin: patternOrigin(
			layer.job,
			(sprite.width / sprite.pixelRatio) * scale,
			(sprite.height / sprite.pixelRatio) * scale,
		),
		angle: bearing === 0 ? undefined : -bearing,
		scale,
	};
}

/**
 * A corner of a copy of a pattern of `width` × `height` pixels anchored at the world's origin
 * (mercator 0, 0), the one nearest to the image's center, turned into place with the map.
 */
function patternOrigin(job: RenderJob, width: number, height: number): [number, number] {
	const { width: w, height: h } = job.renderer;
	const worldSize = 512 * 2 ** job.view.zoom;
	const center = new Point2D(job.view.center[0], job.view.center[1]).getProject2Pixel();
	// The world's origin on the north-up map, then the corner of its copies nearest the center.
	const x = w / 2 - center.x * worldSize;
	const y = h / 2 - center.y * worldSize;
	const nearX = x + Math.round((w / 2 - x) / width) * width;
	const nearY = y + Math.round((h / 2 - y) / height) * height;
	const turned = job.projection
		? job.projection.fromNorthUp(nearX, nearY)
		: new Point2D(nearX, nearY);
	return [turned.x, turned.y];
}
