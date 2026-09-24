/**
 * The styles the regions draw (see `regions.ts`), and the fonts they name.
 */
import { resolve } from 'node:path';
import { inlineSources, osm, satellite } from '@versatiles/style';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Region, StyleName } from './regions.js';
import { cells as featureCells, featuresStyle } from './scenes/features.js';
import { geojsonStyle } from './scenes/geojson.js';
import type { Cell } from './scenes/grid.js';
import { cells as patternCells, patternsStyle } from './scenes/patterns.js';
import { cells as sourceCells, sourcesStyle } from './scenes/sources.js';
import { cells as symbolCells, symbolsStyle } from './scenes/symbols.js';

/**
 * The fonts the styles name in `text-font`, mapped to real files.
 *
 * A style only names its fonts; MapLibre then fetches pre-rendered SDF glyphs from its
 * glyph server, which a renderer drawing real text cannot use. Without these, both
 * renderers fall back to whatever the machine has installed and every label is measured
 * against the wrong typeface.
 */
const fontDir = resolve(import.meta.dirname, '../../node_modules/@fontsource/noto-sans/files');
export const fonts: Record<string, string> = {
	noto_sans_regular: resolve(fontDir, 'noto-sans-latin-400-normal.woff2'),
	noto_sans_bold: resolve(fontDir, 'noto-sans-latin-700-normal.woff2'),
};

const styleCache = new Map<string, StyleSpecification>();

/** The style `region` draws. */
export async function getStyle(region: Region): Promise<StyleSpecification> {
	const projection = region.projection ?? 'mercator';
	const labels = region.labels ?? false;
	const outlines = region.outlines ?? false;
	const cacheKey = `${region.style}-${projection}-${String(labels)}-${String(outlines)}`;
	let style = styleCache.get(cacheKey);
	if (!style) {
		style = await buildStyle(region.style, projection, labels, outlines);
		styleCache.set(cacheKey, style);
	}
	return style;
}

async function buildStyle(
	name: Region['style'],
	projection: 'mercator' | 'globe',
	labels: boolean,
	outlines: boolean,
): Promise<StyleSpecification> {
	switch (name) {
		case 'vector': {
			const style = await inlineSources(
				osm({ theme: 'colorful', projection, layers: { labels, icons: labels } }),
			);
			if (outlines) addOutlines(style);
			return style;
		}
		case 'satellite':
			return inlineSources(satellite({ projection, osmOverlay: false }));
		case 'geojson':
			return geojsonStyle();
		case 'features':
			return featuresStyle();
		case 'symbols':
			return symbolsStyle();
		case 'sources':
			return sourcesStyle();
		case 'patterns':
			return patternsStyle();
	}
}

/** The cells of a style that is a grid of single-feature checks (see `scenes/grid.ts`). */
export function sceneCells(name: StyleName): Cell[] | undefined {
	if (name === 'features') return featureCells;
	if (name === 'symbols') return symbolCells;
	if (name === 'sources') return sourceCells;
	if (name === 'patterns') return patternCells;
	return undefined;
}

/** Line layers on polygons, which the VersaTiles styles do not have. */
function addOutlines(style: StyleSpecification): void {
	const source = Object.keys(style.sources)[0]!;
	style.layers.push(
		{
			id: 'water-outline',
			type: 'line',
			source,
			'source-layer': 'water_polygons',
			paint: { 'line-color': '#0033ff', 'line-width': 3, 'line-opacity': 0.5 },
		},
		{
			id: 'building-outline',
			type: 'line',
			source,
			'source-layer': 'buildings',
			paint: { 'line-color': '#cc0000', 'line-width': 1.5 },
		},
	);
}
