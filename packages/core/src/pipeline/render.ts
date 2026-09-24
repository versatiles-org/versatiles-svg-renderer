import { type Feature, type Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import { getLayerFeatures, getRasterTiles } from '../sources/index.js';
import { loadSpriteAtlas } from '../sources/sprite.js';
import type { SpriteAtlas } from '../sources/sprite.js';
import { getTile, type TileLoader } from '../sources/tiles.js';
import { defaultFetch, type FetchFunction } from '../sources/fetch.js';
import { resolveSources } from '../sources/resolve.js';
import {
	GLYPH_EM,
	loadGlyphRange,
	rangeStart,
	type Glyph,
	type GlyphRange,
} from '../sources/glyphs.js';
import type { GlyphOutline } from './glyph_outline.js';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { getGlobalState, getLayerStyles } from './style_layer.js';
import type {
	EvaluatedProperties,
	PossiblyEvaluatedPropertyValue,
	StyleLayer,
} from './style_layer.js';
import type { RenderJob, Renderer, StringRenderer } from '../renderer/svg.js';
import type {
	FillPattern,
	GlyphPlacement,
	IconStyle,
	LineStyle,
	PlacedGlyph,
	SymbolStyle,
} from '../renderer/types.js';
import {
	CollisionIndex,
	glyphBox,
	iconBox,
	layoutText,
	paddedBox,
	placeSymbols,
	type Box,
	type CollisionOptions,
	type PlacedSymbol,
} from './collision.js';
import { GEOJSON_LAYER } from '../geometry.js';
import { Feature as LayerFeature, Point2D } from '../geometry.js';
import type { Features, SourceFeatures } from '../geometry.js';
import { labelAnchors } from './label_anchors.js';
import {
	breakLines,
	glyphAdvances,
	glyphMetrics,
	tableMetrics,
	type FontMetrics,
} from './text_metrics.js';
import { traceGlyph } from './glyph_outline.js';
import { fitsMaxAngle, layoutAlongLine, lineAnchors, measureLine, pointAt } from './line_labels.js';
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
	/** The style's sources, with TileJSON sources completed (see {@link resolveSources}). */
	getSources(): Promise<StyleSpecification['sources']>;
	loadTile: TileLoader;
	/**
	 * A range of 256 glyphs of a font stack, from the style's `glyphs`: `undefined` if it cannot
	 * be loaded.
	 */
	getGlyphRange(fontStack: string, start: number): Promise<GlyphRange | undefined>;
	/** Traced glyph outlines, by font stack and code point, shared by renders. */
	outlines: Map<string, GlyphOutline>;
}

/** A context without any caching, for rendering a single view. */
export function createRenderContext(
	style: StyleSpecification,
	fetchFn: FetchFunction = defaultFetch,
): RenderContext {
	return {
		layers: getLayerStyles(style.layers, getGlobalState(style)),
		getSprite: () => loadSpriteAtlas(style, fetchFn),
		getSources: async () => (await resolveSources(style.sources, fetchFn)).sources,
		loadTile: (url, z, x, y) => getTile(url, z, x, y, fetchFn),
		getGlyphRange: (fontStack, start) =>
			typeof style.glyphs === 'string'
				? loadGlyphRange(style.glyphs, fontStack, start, fetchFn)
				: Promise.resolve(undefined),
		outlines: new Map(),
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
		bearing: job.view.bearing,
		padding: job.view.padding,
	});
	const clipCircle = job.projection.clipCircle;
	if (clipCircle) job.renderer.setClipCircle?.(clipCircle);
	const sources = await context.getSources();
	await render({ ...job, style: { ...job.style, sources } }, context);
	job.renderer.finish?.();
	return job.renderer;
}

export async function renderMap(
	job: RenderJob<StringRenderer>,
	context?: RenderContext,
): Promise<string> {
	return (await drawMap(job, context)).getString();
}

function getFeatures(sourceFeatures: SourceFeatures, layerStyle: StyleLayer): Features | undefined {
	const layerFeatures = sourceFeatures.get(layerStyle.source);
	// GeoJSON sources ignore "source-layer", as in MapLibre.
	return layerFeatures?.get(layerStyle.sourceLayer) ?? layerFeatures?.get(GEOJSON_LAYER);
}

async function render(job: RenderJob, context: RenderContext): Promise<void> {
	// The sprite holds the icons, and the images of patterns.
	const needsSprite =
		(job.labels ?? 'none') !== 'none' ||
		context.layers.some((layer) => layer.usesPattern && !layer.isHidden(job.view.zoom));
	const [sourceFeatures, spriteAtlas] = await Promise.all([
		getLayerFeatures(job, context.loadTile),
		needsSprite ? context.getSprite() : Promise.resolve(new Map() as SpriteAtlas),
	]);
	const availableImages: string[] = [...spriteAtlas.keys()];
	const makeLayer = (layerStyle: StyleLayer): Layer => ({
		job,
		context,
		layerStyle,
		sourceFeatures,
		spriteAtlas,
		availableImages,
	});

	// Labels and icons are placed before anything is drawn, from the top layer down, as
	// in MapLibre: a symbol of a higher layer wins over one below that it would overlap.
	const symbols = new Map<StyleLayer, SymbolEntry[]>();
	if ((job.labels ?? 'none') !== 'none') {
		const index = new CollisionIndex(job.renderer.width, job.renderer.height);
		for (const layerStyle of [...context.layers].reverse()) {
			if (layerStyle.type !== 'symbol' || layerStyle.isHidden(job.view.zoom)) continue;
			const entries = await prepareSymbolLayer(makeLayer(layerStyle));
			placeSymbols(entries, index);
			symbols.set(layerStyle, entries);
		}
	}

	for (const layerStyle of context.layers) {
		if (layerStyle.isHidden(job.view.zoom)) continue;

		// One function per layer type. Besides keeping each short, this lets a CPU profile
		// tell the layer types apart: `npm run bench` divides the time by these functions.
		const layer = makeLayer(layerStyle);
		switch (layerStyle.type) {
			case 'background':
				await renderBackgroundLayer(layer);
				continue;
			case 'fill':
				await renderFillLayer(layer);
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
				await renderSymbolLayer(layer, symbols.get(layerStyle) ?? []);
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
	sourceFeatures: SourceFeatures;
	spriteAtlas: SpriteAtlas;
	availableImages: string[];
}

/** A layer's paint and layout values at the render's zoom, per feature where data-driven. */
interface LayerValues {
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
function screenTranslate(job: RenderJob, translate: unknown, anchor: unknown): [number, number] {
	const [x, y] = translate as [number, number];
	const bearing = job.projection?.bearing ?? 0;
	if (anchor === 'viewport' || bearing === 0) return [x, y];
	const angle = (bearing * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return [x * cos + y * sin, -x * sin + y * cos];
}

/** Applies `text-transform`, with the locale-aware case mapping MapLibre uses. */
export function transformText(text: string, transform: unknown): string {
	if (transform === 'uppercase') return text.toLocaleUpperCase();
	if (transform === 'lowercase') return text.toLocaleLowerCase();
	return text;
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

async function renderBackgroundLayer(layer: Layer): Promise<void> {
	const { getPaint } = evaluateLayer(layer);
	const pattern = resolvePattern(layer, getPaint('background-pattern'));
	// A pattern whose image is not in the sprite draws nothing, as in MapLibre.
	if (pattern === null) return;
	await layer.job.renderer.drawBackgroundFill({
		color: getPaint('background-color') as MaplibreColor,
		opacity: getPaint('background-opacity') as number,
		pattern,
	});
}

/**
 * The pattern a `*-pattern` value names: `undefined` without one, `null` if its image is
 * not in the sprite.
 */
function resolvePattern(layer: Layer, value: unknown): FillPattern | null | undefined {
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
	return {
		name,
		sprite,
		origin: patternOrigin(
			layer.job,
			sprite.width / sprite.pixelRatio,
			sprite.height / sprite.pixelRatio,
		),
		angle: bearing === 0 ? undefined : -bearing,
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

async function renderFillLayer(layer: Layer): Promise<void> {
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

function renderLineLayer(layer: Layer): void {
	// Stroke real linestrings plus polygon boundaries (MapLibre draws polygon rings in a
	// line layer). polygonOutlines is kept out of `fill` so polygons are not filled a
	// second time.
	const features = getFeatures(layer.sourceFeatures, layer.layerStyle);
	const lineStrings = [...(features?.linestrings ?? []), ...(features?.polygonOutlines ?? [])];
	if (lineStrings.length === 0) return;
	const lineStringFeatures = filterFeatures(layer, lineStrings);
	if (lineStringFeatures.length === 0) return;

	const { getPaint, getLayout } = evaluateLayer(layer);
	const sorted = sortByKey(lineStringFeatures, (feature) => getLayout('line-sort-key', feature));
	const styled = sorted.flatMap((feature): Parameters<Renderer['drawLineStrings']>[1] => {
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
		const gapWidth = getPaint('line-gap-width', feature) as number;
		if (!(gapWidth > 0)) return [[feature, style]];
		// With a gap, MapLibre draws the line as a band on each side of it, from gap/2 to
		// gap/2 + width: two lines of the same width, offset by ±(gap + width)/2.
		const shift = (gapWidth + style.width) / 2;
		return [
			[feature, { ...style, offset: style.offset - shift }],
			[feature, { ...style, offset: style.offset + shift }],
		];
	});
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
	const points = getFeatures(layer.sourceFeatures, layer.layerStyle)?.points;
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

/** A label, an icon or both at one point, and whether collision detection keeps them. */
interface SymbolEntry extends PlacedSymbol {
	icon?: [LayerFeature, IconStyle];
	label?: [LayerFeature, SymbolStyle];
}

/**
 * The symbols of a layer, in the order they are placed and drawn: each feature's label
 * and icon at each point it is placed at, with their collision boxes.
 */
async function prepareSymbolLayer(layer: Layer): Promise<SymbolEntry[]> {
	const { job, context, layerStyle, spriteAtlas } = layer;
	const features = getFeatures(layer.sourceFeatures, layerStyle);
	const allFeatures = [
		...(features?.points ?? []),
		...(features?.linestrings ?? []),
		...(features?.polygons ?? []),
	];
	if (allFeatures.length === 0) return [];
	const filtered = filterFeatures(layer, allFeatures);
	if (filtered.length === 0) return [];

	const { getPaint, getLayout } = evaluateLayer(layer);
	const symbolFeatures = sortByKey(filtered, (feature) => getLayout('symbol-sort-key', feature));
	const labelText = (feature: LayerFeature): string => {
		const textField = getLayout('text-field', feature);
		const textRaw = textField != null ? (textField as { toString(): string }).toString() : '';
		return transformText(
			resolveTokens(textRaw, feature.properties),
			getLayout('text-transform', feature),
		);
	};

	// Drawn as glyphs, labels need the style's glyphs before they are laid out, with their
	// metrics: all ranges the layer's labels use, loaded together.
	const glyphMode = job.labels === 'glyphs' || job.labels === 'glyphs-text';
	const glyphRanges = new Map<string, GlyphRange | undefined>();
	if (glyphMode) {
		const wanted = new Set<string>();
		for (const feature of symbolFeatures) {
			const fontStack = (getLayout('text-font', feature) as string[]).join(',');
			for (const char of labelText(feature)) {
				wanted.add(`${fontStack}\0${String(rangeStart(char.codePointAt(0)!))}`);
			}
		}
		await Promise.all(
			[...wanted].map(async (key) => {
				const [fontStack, start] = key.split('\0') as [string, string];
				glyphRanges.set(key, await context.getGlyphRange(fontStack, Number(start)));
			}),
		);
	}

	const entries: SymbolEntry[] = [];
	for (const feature of symbolFeatures) {
		// Styles are evaluated for the feature itself (`geometry-type` must see a polygon as
		// a polygon); only then is each symbol moved to the points it is placed at.
		const iconImage = getLayout('icon-image', feature);
		const iconName =
			iconImage != null
				? resolveTokens((iconImage as { toString(): string }).toString(), feature.properties)
				: '';
		const sprite = iconName ? spriteAtlas.get(iconName) : undefined;
		const iconStyle: IconStyle | undefined = sprite && {
			image: iconName,
			size: getLayout('icon-size', feature) as number,
			anchor: getLayout('icon-anchor', feature) as string,
			offset: getLayout('icon-offset', feature) as [number, number],
			rotate: getLayout('icon-rotate', feature) as number,
			opacity: getPaint('icon-opacity', feature) as number,
			sdf: sprite.sdf,
			color: getPaint('icon-color', feature) as MaplibreColor,
			haloColor: getPaint('icon-halo-color', feature) as MaplibreColor,
			haloWidth: getPaint('icon-halo-width', feature) as number,
		};

		const text = labelText(feature);
		const labelStyle: SymbolStyle | undefined = text
			? {
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
					letterSpacing: getLayout('text-letter-spacing', feature) as number,
				}
			: undefined;
		if (!iconStyle && !labelStyle) continue;

		// The label's glyphs, if all of them could be loaded: then it is measured with their
		// metrics and drawn as them; else measured with Noto Sans and drawn as text.
		const fontStack = labelStyle?.font.join(',') ?? '';
		const glyphAt = (codePoint: number): Glyph | undefined =>
			glyphRanges.get(`${fontStack}\0${String(rangeStart(codePoint))}`)?.get(codePoint);
		const asGlyphs =
			glyphMode && labelStyle !== undefined && hasAllGlyphs(labelStyle.text, glyphAt);
		const fallbackMetrics = tableMetrics(labelStyle?.font);
		const metrics = asGlyphs ? glyphMetrics(glyphAt, fallbackMetrics) : fallbackMetrics;
		const outlineOf = (codePoint: number): GlyphOutline | undefined => {
			const glyph = glyphAt(codePoint);
			if (!glyph) return undefined;
			const key = `${fontStack}\0${String(codePoint)}`;
			let outline = context.outlines.get(key);
			if (!outline) {
				outline = traceGlyph(glyph, key);
				context.outlines.set(key, outline);
			}
			return outline;
		};
		const textOverlay = job.labels === 'glyphs-text';

		const options: CollisionOptions = {
			textAllowOverlap: getLayout('text-allow-overlap', feature) === true,
			iconAllowOverlap: getLayout('icon-allow-overlap', feature) === true,
			textIgnorePlacement: getLayout('text-ignore-placement', feature) === true,
			iconIgnorePlacement: getLayout('icon-ignore-placement', feature) === true,
			textOptional: getLayout('text-optional', feature) === true,
			iconOptional: getLayout('icon-optional', feature) === true,
		};
		const textPadding = getLayout('text-padding', feature) as number;
		const iconPadding = (getLayout('icon-padding', feature) as { values: number[] }).values;

		const placement = getLayout('symbol-placement', feature) as string;
		const textTranslate = screenTranslate(
			job,
			getPaint('text-translate', feature),
			getPaint('text-translate-anchor', feature),
		);
		const iconTranslate = screenTranslate(
			job,
			getPaint('icon-translate', feature),
			getPaint('icon-translate-anchor', feature),
		);
		const pointAtAnchor = (x: number, y: number): LayerFeature =>
			new LayerFeature({
				type: 'Point',
				geometry: [[new Point2D(x, y)]],
				id: feature.id,
				properties: feature.properties,
			});

		if (placement === 'point' || feature.type === 'Point') {
			// A point label is broken into lines of at most `text-max-width` ems.
			const lines = labelStyle
				? breakLines(
						labelStyle.text,
						metrics,
						getLayout('text-max-width', feature) as number,
						labelStyle.letterSpacing,
					)
				: [];
			const lineHeight = getLayout('text-line-height', feature) as number;
			const justify = getLayout('text-justify', feature) as string;
			// Aligned to the map, a label or icon turns with it; to the viewport (the default for
			// points), it stays upright.
			const mapRotation = -(job.projection?.bearing ?? 0);
			const turn = (alignment: unknown): number => (alignment === 'map' ? mapRotation : 0);
			const textTurn = turn(getLayout('text-rotation-alignment', feature));
			const iconTurn = turn(getLayout('icon-rotation-alignment', feature));
			const lineStyle = labelStyle &&
				lines.length > 0 && {
					...labelStyle,
					text: lines.join('\n'),
					rotate: labelStyle.rotate + textTurn,
				};
			const pointIcon = iconStyle && { ...iconStyle, rotate: iconStyle.rotate + iconTurn };
			for (const point of labelAnchors(feature)) {
				// text-translate and icon-translate move the label and the icon, and what they block.
				const tx = point.x + textTranslate[0];
				const ty = point.y + textTranslate[1];
				const ix = point.x + iconTranslate[0];
				const iy = point.y + iconTranslate[1];
				let label: [LayerFeature, SymbolStyle] | undefined;
				let textBoxes: Box[] | undefined;
				if (lineStyle) {
					const layout = layoutText(tx, ty, lineStyle, lines, lineHeight, justify, metrics);
					let drawn: SymbolStyle = layout.lines
						? { ...lineStyle, lines: layout.lines, justify: layout.justify }
						: lineStyle;
					if (asGlyphs) {
						drawn = {
							...lineStyle,
							glyphs: glyphsOfLines(layout.lineBoxes, lineStyle, outlineOf, tx, ty, metrics),
							textOverlay,
							// The invisible text, line by line, as wide as the glyphs.
							lines: layout.lineBoxes.map((line) => ({
								text: line.text,
								x: line.left + line.width / 2,
								y: line.y,
								width: line.width,
							})),
							justify: 'center',
						};
					}
					label = [pointAtAnchor(tx, ty), drawn];
					textBoxes = [paddedBox(layout.box, lineStyle, tx, ty, textPadding)];
				}
				entries.push({
					icon: pointIcon && [pointAtAnchor(ix, iy), pointIcon],
					label,
					iconBox: pointIcon && iconBox(ix, iy, pointIcon, sprite!, iconPadding),
					textBoxes,
					options,
					showIcon: false,
					showText: false,
				});
			}
			continue;
		}

		// Along lines: anchors repeated along each line, where the label fits.
		// "auto" means "map" for symbols along lines.
		const alignedToMap = (alignment: unknown): boolean =>
			alignment === 'map' || alignment === 'auto';
		const textAlongLine =
			labelStyle !== undefined && alignedToMap(getLayout('text-rotation-alignment', feature));
		const iconAlongLine =
			iconStyle !== undefined && alignedToMap(getLayout('icon-rotation-alignment', feature));
		// Along a line, a label is one line.
		const glyphs =
			labelStyle && glyphAdvances(labelStyle.text.replace(/\s+/g, ' '), metrics, labelStyle.size);
		const textLength = glyphs ? glyphs.advances.reduce((sum, width) => sum + width, 0) : 0;
		const iconLength = iconStyle ? (sprite!.width / sprite!.pixelRatio) * iconStyle.size : 0;
		const labelLength = Math.max(textLength, iconLength);
		const textSize = labelStyle?.size ?? (getLayout('text-size', feature) as number);
		// Spacing is in pixels of the tile's zoom level, whose tiles a fractional zoom enlarges.
		const spacing =
			(getLayout('symbol-spacing', feature) as number) *
			2 ** (job.view.zoom - Math.floor(job.view.zoom));
		const maxAngle = ((getLayout('text-max-angle', feature) as number) * Math.PI) / 180;
		const keepUpright = getLayout('text-keep-upright', feature) !== false;

		for (const points of feature.geometry) {
			const line = measureLine(points);
			for (const distance of lineAnchors(line, labelLength, spacing, textSize, placement)) {
				// MapLibre leaves out a label where its line bends too sharply.
				if (textAlongLine && !fitsMaxAngle(line, distance, textLength, textSize * 0.6, maxAngle)) {
					continue;
				}
				const anchor = pointAt(line, distance);
				const at = pointAtAnchor(anchor.x, anchor.y);
				const lineAngle = (anchor.angle * 180) / Math.PI;

				let label: [LayerFeature, SymbolStyle] | undefined;
				let textBoxes: Box[] | undefined;
				if (labelStyle && glyphs && textAlongLine) {
					const offset: [number, number] = [
						labelStyle.offset[0] * labelStyle.size,
						labelStyle.offset[1] * labelStyle.size,
					];
					const path = layoutAlongLine(
						line,
						distance,
						glyphs.chars,
						glyphs.advances,
						offset,
						keepUpright,
					).map((glyph) => ({
						...glyph,
						x: glyph.x + textTranslate[0],
						y: glyph.y + textTranslate[1],
					}));
					label = [
						at,
						asGlyphs
							? {
									...labelStyle,
									path,
									glyphs: glyphsAlongPath(path, labelStyle, outlineOf, metrics),
									textOverlay,
								}
							: { ...labelStyle, path },
					];
					textBoxes = path.map((glyph, i) =>
						glyphBox(glyph, glyphs.advances[i]!, labelStyle.size, textPadding),
					);
				} else if (labelStyle) {
					const tx = anchor.x + textTranslate[0];
					const ty = anchor.y + textTranslate[1];
					const layout = layoutText(
						tx,
						ty,
						labelStyle,
						[labelStyle.text],
						undefined,
						undefined,
						metrics,
					);
					label = [
						pointAtAnchor(tx, ty),
						asGlyphs
							? {
									...labelStyle,
									glyphs: glyphsOfLines(layout.lineBoxes, labelStyle, outlineOf, tx, ty, metrics),
									textOverlay,
								}
							: labelStyle,
					];
					textBoxes = [paddedBox(layout.box, labelStyle, tx, ty, textPadding)];
				}

				const lineIcon =
					iconStyle && iconAlongLine
						? { ...iconStyle, rotate: iconStyle.rotate + lineAngle }
						: iconStyle;
				const ix = anchor.x + iconTranslate[0];
				const iy = anchor.y + iconTranslate[1];
				entries.push({
					icon: lineIcon && [pointAtAnchor(ix, iy), lineIcon],
					label,
					iconBox: lineIcon && iconBox(ix, iy, lineIcon, sprite!, iconPadding),
					textBoxes,
					options,
					showIcon: false,
					showText: false,
				});
			}
		}
	}
	return entries;
}

/** Whether every character of `text` has a glyph, except white space, which needs none. */
function hasAllGlyphs(text: string, glyphAt: (codePoint: number) => Glyph | undefined): boolean {
	for (const char of text) {
		if (!/\s/.test(char) && !glyphAt(char.codePointAt(0)!)) return false;
	}
	return true;
}

/**
 * The glyphs of a label's lines, as MapLibre places them: along each line from its start,
 * one advance after the other, turned with `text-rotate` around the label's point `x`, `y`.
 */
function glyphsOfLines(
	lineBoxes: { text: string; left: number; y: number }[],
	style: SymbolStyle,
	outlineOf: (codePoint: number) => GlyphOutline | undefined,
	x: number,
	y: number,
	metrics: FontMetrics,
): PlacedGlyph[] {
	const scale = style.size / GLYPH_EM;
	const spacing = (style.letterSpacing ?? 0) * style.size;
	const radians = (style.rotate * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const placed: PlacedGlyph[] = [];
	for (const line of lineBoxes) {
		let pen = line.left;
		for (const char of line.text) {
			const advance = metrics.advance(char) * style.size;
			const outline = outlineOf(char.codePointAt(0)!);
			if (outline) {
				const dx = pen + advance / 2 - x;
				const dy = line.y - y;
				placed.push({
					outline,
					x: x + dx * cos - dy * sin,
					y: y + dx * sin + dy * cos,
					angle: style.rotate,
					scale,
				});
			}
			pen += advance + spacing;
		}
	}
	return placed;
}

/**
 * The glyphs of a label along a line: each grapheme's glyphs at its place on the line,
 * turned with it (a letter's accents follow the letter along the line).
 */
function glyphsAlongPath(
	path: GlyphPlacement[],
	style: SymbolStyle,
	outlineOf: (codePoint: number) => GlyphOutline | undefined,
	metrics: FontMetrics,
): PlacedGlyph[] {
	const scale = style.size / GLYPH_EM;
	const placed: PlacedGlyph[] = [];
	for (const grapheme of path) {
		const radians = (grapheme.angle * Math.PI) / 180;
		let along = -(metrics.advance(grapheme.text) * style.size) / 2;
		for (const char of grapheme.text) {
			const advance = metrics.advance(char) * style.size;
			const outline = outlineOf(char.codePointAt(0)!);
			if (outline) {
				const offset = along + advance / 2;
				placed.push({
					outline,
					x: grapheme.x + offset * Math.cos(radians),
					y: grapheme.y + offset * Math.sin(radians),
					angle: grapheme.angle,
					scale,
				});
			}
			along += advance;
		}
	}
	return placed;
}

/** Draws the symbols of a layer that collision detection kept: icons first, then labels. */
async function renderSymbolLayer(layer: Layer, symbols: SymbolEntry[]): Promise<void> {
	const { job, layerStyle, spriteAtlas } = layer;
	const icons = symbols.flatMap((symbol) => (symbol.showIcon && symbol.icon ? [symbol.icon] : []));
	const labels = symbols.flatMap((symbol) =>
		symbol.showText && symbol.label ? [symbol.label] : [],
	);
	await job.renderer.drawIcons(`${layerStyle.id}-icons`, icons, spriteAtlas);
	job.renderer.drawLabels(`${layerStyle.id}-labels`, labels);
}
