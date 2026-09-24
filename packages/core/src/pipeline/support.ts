/**
 * Which parts of a style the renderer draws, and warnings about the parts it does not, so
 * that a gap of the renderer is not mistaken for a bug of the style.
 */
import { compileSourceFilter } from '../sources/geojson.js';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

/**
 * The paint and layout properties the renderer reads, by layer type. Kept in sync with
 * `render.ts` by a test.
 */
export const SUPPORTED_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
	background: ['background-color', 'background-opacity', 'background-pattern'],
	fill: [
		'fill-antialias',
		'fill-color',
		'fill-opacity',
		'fill-outline-color',
		'fill-pattern',
		'fill-sort-key',
		'fill-translate',
		'fill-translate-anchor',
	],
	line: [
		'line-blur',
		'line-cap',
		'line-color',
		'line-dasharray',
		'line-gap-width',
		'line-join',
		'line-miter-limit',
		'line-offset',
		'line-opacity',
		'line-pattern',
		'line-round-limit',
		'line-sort-key',
		'line-translate',
		'line-translate-anchor',
		'line-width',
	],
	raster: [
		'raster-brightness-max',
		'raster-brightness-min',
		'raster-contrast',
		'raster-hue-rotate',
		'raster-opacity',
		'raster-resampling',
		'raster-saturation',
	],
	circle: [
		'circle-blur',
		'circle-color',
		'circle-opacity',
		'circle-radius',
		'circle-sort-key',
		'circle-stroke-color',
		'circle-stroke-opacity',
		'circle-stroke-width',
		'circle-translate',
		'circle-translate-anchor',
	],
	symbol: [
		'icon-allow-overlap',
		'icon-anchor',
		'icon-color',
		'icon-halo-color',
		'icon-halo-width',
		'icon-ignore-placement',
		'icon-image',
		'icon-offset',
		'icon-opacity',
		'icon-optional',
		'icon-padding',
		'icon-rotate',
		'icon-rotation-alignment',
		'icon-size',
		'icon-text-fit',
		'icon-text-fit-padding',
		'icon-translate',
		'icon-translate-anchor',
		'symbol-placement',
		'symbol-sort-key',
		'symbol-spacing',
		'text-allow-overlap',
		'text-anchor',
		'text-color',
		'text-field',
		'text-font',
		'text-halo-color',
		'text-halo-width',
		'text-ignore-placement',
		'text-keep-upright',
		'text-justify',
		'text-letter-spacing',
		'text-line-height',
		'text-max-angle',
		'text-max-width',
		'text-offset',
		'text-opacity',
		'text-optional',
		'text-padding',
		'text-radial-offset',
		'text-rotate',
		'text-rotation-alignment',
		'text-size',
		'text-transform',
		'text-translate',
		'text-translate-anchor',
		'text-variable-anchor',
		'text-variable-anchor-offset',
	],
};

/**
 * Properties that make no difference to a flat, north-up image: not worth a warning.
 */
const WITHOUT_EFFECT = new Set([
	'visibility',
	'raster-fade-duration',
	'circle-pitch-alignment',
	'circle-pitch-scale',
	'text-pitch-alignment',
	'icon-pitch-alignment',
	'symbol-avoid-edges',
	'symbol-z-order',
	'icon-keep-upright',
]);

const SUPPORTED_SOURCE_TYPES = new Set(['vector', 'raster', 'geojson', 'image']);

/** How many layer ids a warning lists before it cuts the list short. */
const MAX_LISTED = 3;

/**
 * Warnings about the layers and root properties of `style` the renderer does not draw.
 * Hidden layers are skipped, and so are symbol layers unless labels are rendered.
 */
export function checkStyle(style: StyleSpecification, renderLabels: boolean): string[] {
	const warnings: string[] = [];

	if (style.terrain !== undefined) {
		warnings.push('The style property "terrain" is not supported and is ignored.');
	}
	// The sky only shows above the horizon, which a flat map without pitch does not have, and
	// as the atmosphere around the globe.
	const projection = style.projection?.type;
	if (style.sky !== undefined && projection !== undefined && projection !== 'mercator') {
		warnings.push('The style property "sky" is not supported: the globe has no atmosphere.');
	}

	const layersByType = new Map<string, string[]>();
	const layersByProperty = new Map<string, string[]>();
	for (const layer of style.layers) {
		if (layer.layout?.visibility === 'none') continue;
		const supported = SUPPORTED_PROPERTIES[layer.type];
		if (!supported) {
			if (!layersByType.has(layer.type)) layersByType.set(layer.type, []);
			layersByType.get(layer.type)!.push(layer.id);
			continue;
		}
		if (layer.type === 'symbol' && !renderLabels) continue;

		const properties = {
			...(layer as { paint?: Record<string, unknown> }).paint,
			...(layer as { layout?: Record<string, unknown> }).layout,
		};
		for (const name of Object.keys(properties)) {
			if (supported.includes(name) || WITHOUT_EFFECT.has(name)) continue;
			if (!layersByProperty.has(name)) layersByProperty.set(name, []);
			layersByProperty.get(name)!.push(layer.id);
		}
	}

	for (const [type, ids] of layersByType) {
		warnings.push(`Layers of type "${type}" are not supported and are not drawn: ${listIds(ids)}.`);
	}
	if (layersByProperty.size > 0) {
		const list = [...layersByProperty]
			.map(([label, ids]) => `${label} (${listIds(ids)})`)
			.join(', ');
		warnings.push(`These layer properties are not supported and are ignored: ${list}.`);
	}
	return warnings;
}

/**
 * Warnings about sources the renderer cannot draw. `sources` are the style's sources after
 * their TileJSON documents and GeoJSON data were loaded, so a source that still has a
 * `url` but no `tiles`, or GeoJSON `data` that is a URL, is one whose document could not be
 * loaded.
 */
export function checkSources(sources: StyleSpecification['sources']): string[] {
	const warnings: string[] = [];
	for (const [name, source] of Object.entries(sources)) {
		const spec = source as { type: string; url?: unknown; tiles?: unknown; data?: unknown };
		if (!SUPPORTED_SOURCE_TYPES.has(spec.type)) {
			warnings.push(
				`Source "${name}": the type "${spec.type}" is not supported; its layers are not drawn.`,
			);
			continue;
		}
		if (spec.type === 'geojson') {
			if (typeof spec.data === 'string') {
				warnings.push(
					`Source "${name}": the GeoJSON data could not be loaded from ${spec.data}; the source is empty.`,
				);
			}
			try {
				compileSourceFilter((spec as { filter?: unknown }).filter, name);
			} catch (error) {
				warnings.push(
					`Source "${name}": the filter is invalid (${(error as Error).message}); the source is empty.`,
				);
			}
			continue;
		}
		// An image source's `url` is its image, not a TileJSON document.
		if (spec.type === 'image') continue;
		if (!Array.isArray(spec.tiles)) {
			warnings.push(
				typeof spec.url === 'string'
					? `Source "${name}": the TileJSON document could not be loaded from ${spec.url}; the source is empty.`
					: `Source "${name}": it has neither "tiles" nor "url"; the source is empty.`,
			);
		}
	}
	return warnings;
}

function listIds(ids: string[]): string {
	const listed = ids.slice(0, MAX_LISTED).map((id) => `"${id}"`);
	if (ids.length > MAX_LISTED) listed.push(`${String(ids.length - MAX_LISTED)} more`);
	return listed.join(', ');
}
