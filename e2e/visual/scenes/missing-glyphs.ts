/**
 * Labels with letters the glyph server has no glyphs for, one per cell: Tifinagh, which the
 * VersaTiles glyphs leave out. MapLibre leaves out each missing glyph, with no width and no
 * letter spacing, and draws the rest of the label; a label with nothing left it does not draw.
 *
 * | Tifinagh, Latin along a line  | Tifinagh, Arabic, Latin    | Tifinagh along a line     |
 * | Tifinagh                      | three lines, one Tifinagh  | Latin, Tifinagh, spacing  |
 * | Arabic, Tifinagh along a line | Tifinagh between Arabic    |                           |
 *
 * The lines lie in the corners, away from the tile borders at 0° (see `scripts.ts`).
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { gridStyle, type Cell } from './grid.js';
import { scriptCell } from './scripts.js';

/** "Libya" and "Tamazgha" in Tifinagh. */
const LIBYA = 'ⵍⵉⴱⵢⴰ';
const TAMAZGHA = 'ⵜⴰⵎⴰⵣⵖⴰ';

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	scriptCell({
		id: 'missing-latin-line',
		title: 'Tifinagh and Latin along a line',
		text: `${TAMAZGHA} Tamazgha`,
		line: true,
	}),
	// Libya's name in OpenStreetMap, upper-cased as in the VersaTiles style.
	scriptCell({
		id: 'missing-libya',
		title: 'Tifinagh, Arabic and Latin',
		text: `${LIBYA} ليبيا LIBYA`,
	}),
	// Nothing to draw: only the line.
	scriptCell({
		id: 'missing-only-line',
		title: 'Tifinagh along a line',
		text: TAMAZGHA,
		line: true,
	}),
	// Nothing to draw: nothing at all.
	scriptCell({ id: 'missing-only', title: 'Tifinagh', text: LIBYA }),
	// The middle line has nothing to draw, but keeps its height.
	scriptCell({
		id: 'missing-lines',
		title: 'three lines, the middle one Tifinagh',
		text: `Libya\n${LIBYA}\nLibya`,
	}),
	// Spaced apart: the Latin letters and the space, not the missing Tifinagh.
	scriptCell({
		id: 'missing-spacing',
		title: 'Latin and Tifinagh with letter spacing',
		text: `Libya ${LIBYA}`,
		layout: { 'text-letter-spacing': 0.3 },
	}),
	scriptCell({
		id: 'missing-arabic-line',
		title: 'Arabic and Tifinagh along a line',
		text: `ليبيا ${LIBYA}`,
		line: true,
	}),
	// The Tifinagh letter joins no Arabic letter, so beh and alef are written apart, though
	// it is left out.
	scriptCell({
		id: 'missing-between',
		title: 'Tifinagh between Arabic letters',
		text: 'ليبⵢا',
	}),
];

export function missingGlyphsStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
	});
}
