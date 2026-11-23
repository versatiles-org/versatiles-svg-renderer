/**
 * The styles the regions draw (see `regions.ts`), and the fonts they name.
 */
import { resolve } from 'node:path';
import { inlineSources, osm, satellite } from '@versatiles/style';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleImage } from '../../packages/svg-renderer/src/index.js';
import { berlin, type Region, type StyleName } from './regions.js';
import { cells as featureCells, featuresStyle } from './scenes/features.js';
import { geojsonStyle } from './scenes/geojson.js';
import { pmtilesStyle } from './scenes/pmtiles.js';
import { seamsStyle } from './scenes/seams.js';
import type { Cell } from './scenes/grid.js';
import { anchorsStyle, cells as anchorCells } from './scenes/anchors.js';
import { cells as dashCells, dashesStyle } from './scenes/dashes.js';
import { cells as imageCells, images as sceneImages, imagesStyle } from './scenes/images.js';
import { cells as patternCells, patternsStyle } from './scenes/patterns.js';
import { cells as scriptCells, scriptsStyle } from './scenes/scripts.js';
import { cells as missingGlyphCells, missingGlyphsStyle } from './scenes/missing-glyphs.js';
import { cells as combiningCells, combiningStyle } from './scenes/combining.js';
import { cells as overlapCells, overlapStyle } from './scenes/overlap.js';
import { cells as cjkCells, cjkStyle } from './scenes/cjk.js';
import { cells as haloCells, halosStyle } from './scenes/halos.js';
import { cells as haloBlurCells, haloBlurStyle } from './scenes/halo-blur.js';
import { cells as lineLabelCells, lineLabelsStyle } from './scenes/line-labels.js';
import { cells as sourceCells, sourcesStyle } from './scenes/sources.js';
import { cells as symbolCells, symbolsStyle } from './scenes/symbols.js';

/**
 * The fonts the styles name in `text-font`, mapped to real files: Noto Sans, in all the
 * scripts the VersaTiles glyphs cover, as `scripts/generate-glyph-widths.ts` measures them.
 * On the glyph server one name covers them all; fontsource splits them into subsets and
 * packages.
 *
 * A style only names its fonts; MapLibre then fetches pre-rendered SDF glyphs from its
 * glyph server, which a renderer drawing real text cannot use. Without these, both
 * renderers fall back to whatever the machine has installed and every label is measured
 * against the wrong typeface.
 */
export const fonts: Record<string, string[]> = {
	noto_sans_regular: notoFiles(400),
	noto_sans_bold: notoFiles(700),
};

function notoFiles(weight: 400 | 700): string[] {
	const fontsource = resolve(import.meta.dirname, '../../node_modules/@fontsource');
	const packages: [string, string[]][] = [
		[
			'noto-sans',
			[
				'latin',
				'latin-ext',
				'greek',
				'greek-ext',
				'cyrillic',
				'cyrillic-ext',
				'vietnamese',
				'devanagari',
			],
		],
		...[
			'arabic',
			'hebrew',
			'bengali',
			'gurmukhi',
			'gujarati',
			'oriya',
			'tamil',
			'kannada',
			'sinhala',
			'thai',
			'lao',
			'myanmar',
			'khmer',
			'balinese',
			'javanese',
		].map((script): [string, string[]] => [`noto-sans-${script}`, [script]]),
	];
	return packages.flatMap(([name, subsets]) =>
		subsets.map((subset) =>
			resolve(fontsource, name, 'files', `${name}-${subset}-${String(weight)}-normal.woff2`),
		),
	);
}

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
		case 'pmtiles':
			// Berlin's tiles: the archive holds only those around the one region drawing it.
			return pmtilesStyle(await buildStyle('vector', projection, labels, outlines), berlin);
		case 'mlt':
			return pmtilesStyle(await buildStyle('vector', projection, labels, outlines), berlin, 'mlt');
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
		case 'dashes':
			return dashesStyle();
		case 'anchors':
			return anchorsStyle();
		case 'seams':
			return seamsStyle();
		case 'images':
			return imagesStyle();
		case 'scripts':
			return scriptsStyle();
		case 'missing-glyphs':
			return missingGlyphsStyle();
		case 'combining':
			return combiningStyle();
		case 'overlap':
			return overlapStyle();
		case 'cjk':
			return cjkStyle();
		case 'halos':
			return halosStyle();
		case 'halo-blur':
			return haloBlurStyle();
		case 'line-labels':
			return lineLabelsStyle();
	}
}

/** The images that `region`'s style uses besides its sprite, as `map.addImage` takes them. */
export function getImages(region: Region): StyleImage[] {
	return region.style === 'images' ? sceneImages : [];
}

/** The cells of a style that is a grid of single-feature checks (see `scenes/grid.ts`). */
export function sceneCells(name: StyleName): Cell[] | undefined {
	if (name === 'features') return featureCells;
	if (name === 'symbols') return symbolCells;
	if (name === 'sources') return sourceCells;
	if (name === 'patterns') return patternCells;
	if (name === 'dashes') return dashCells;
	if (name === 'anchors') return anchorCells;
	if (name === 'images') return imageCells;
	if (name === 'scripts') return scriptCells;
	if (name === 'missing-glyphs') return missingGlyphCells;
	if (name === 'combining') return combiningCells;
	if (name === 'overlap') return overlapCells;
	if (name === 'cjk') return cjkCells;
	if (name === 'halos') return haloCells;
	if (name === 'halo-blur') return haloBlurCells;
	if (name === 'line-labels') return lineLabelCells;
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
