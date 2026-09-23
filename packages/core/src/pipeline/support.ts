/**
 * Which parts of a style the renderer draws, and warnings about the parts it does not, so
 * that a gap of the renderer is not mistaken for a bug of the style.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

/**
 * The paint and layout properties the renderer reads, by layer type. Kept in sync with
 * `render.ts` by a test.
 */
export const SUPPORTED_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
	background: ['background-color', 'background-opacity'],
	fill: ['fill-antialias', 'fill-color', 'fill-opacity', 'fill-outline-color', 'fill-translate'],
	line: [
		'line-blur',
		'line-cap',
		'line-color',
		'line-dasharray',
		'line-join',
		'line-miter-limit',
		'line-offset',
		'line-opacity',
		'line-translate',
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
		'circle-color',
		'circle-opacity',
		'circle-radius',
		'circle-stroke-color',
		'circle-stroke-width',
		'circle-translate',
	],
	symbol: [
		'icon-anchor',
		'icon-color',
		'icon-halo-color',
		'icon-halo-width',
		'icon-image',
		'icon-offset',
		'icon-opacity',
		'icon-rotate',
		'icon-size',
		'text-anchor',
		'text-color',
		'text-field',
		'text-font',
		'text-halo-color',
		'text-halo-width',
		'text-offset',
		'text-opacity',
		'text-rotate',
		'text-size',
	],
};

/**
 * Properties that make no difference to a flat, north-up image, or only to a feature whose
 * absence is documented (label collisions) or already reported (labels along lines,
 * wrapped text): not worth a warning.
 */
const WITHOUT_EFFECT = new Set([
	'visibility',
	'raster-fade-duration',
	'fill-translate-anchor',
	'line-translate-anchor',
	'circle-translate-anchor',
	'text-translate-anchor',
	'icon-translate-anchor',
	'circle-pitch-alignment',
	'circle-pitch-scale',
	'text-pitch-alignment',
	'icon-pitch-alignment',
	'text-rotation-alignment',
	'icon-rotation-alignment',
	'text-allow-overlap',
	'icon-allow-overlap',
	'text-ignore-placement',
	'icon-ignore-placement',
	'text-optional',
	'icon-optional',
	'text-padding',
	'icon-padding',
	'symbol-avoid-edges',
	'symbol-z-order',
	'symbol-spacing',
	'text-keep-upright',
	'icon-keep-upright',
	'text-max-angle',
	'text-justify',
	'text-line-height',
	'line-round-limit',
]);

/** Properties whose default value is what the renderer draws; any other value is not supported. */
const SUPPORTED_VALUES: Readonly<Record<string, unknown>> = {
	'symbol-placement': 'point',
	'text-transform': 'none',
	'icon-text-fit': 'none',
};

const SUPPORTED_SOURCE_TYPES = new Set(['vector', 'raster', 'geojson']);

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
		for (const [name, value] of Object.entries(properties)) {
			if (supported.includes(name) || WITHOUT_EFFECT.has(name)) continue;
			if (name in SUPPORTED_VALUES && value === SUPPORTED_VALUES[name]) continue;
			const label =
				typeof value === 'string' && name in SUPPORTED_VALUES ? `${name}: "${value}"` : name;
			if (!layersByProperty.has(label)) layersByProperty.set(label, []);
			layersByProperty.get(label)!.push(layer.id);
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
		const spec = source as {
			type: string;
			url?: unknown;
			tiles?: unknown;
			data?: unknown;
			scheme?: unknown;
		};
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
			continue;
		}
		if (!Array.isArray(spec.tiles)) {
			warnings.push(
				typeof spec.url === 'string'
					? `Source "${name}": the TileJSON document could not be loaded from ${spec.url}; the source is empty.`
					: `Source "${name}": it has neither "tiles" nor "url"; the source is empty.`,
			);
		}
		if (spec.scheme === 'tms') {
			warnings.push(
				`Source "${name}": the scheme "tms" is not supported; its tiles are loaded as "xyz".`,
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
