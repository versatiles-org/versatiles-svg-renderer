/**
 * Labels in scripts written right to left, one per cell: Arabic letters joined in the shapes
 * their neighbours give them, and text put into the order it is drawn, at points (on one line
 * and on several) and along lines.
 *
 * | Hebrew along a line       | Hebrew, Latin, brackets  | Arabic along a line       |
 * | Arabic                    | Arabic over Latin        | Persian                   |
 * | Arabic with digits, line  | Arabic, several lines    | Arabic, letter spacing    |
 *
 * The lines lie in the corners: one in the middle column or row would cross 0°, a tile
 * border at zoom 12, where MapLibre places a label on each tile's part of the line, so
 * elsewhere than on the whole line, or leaves it out.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { collection, feature, gridStyle, type Cell } from './grid.js';

/** A label `text` at the cell's center, or along a line through it (drawn below it). */
function scriptCell(options: {
	id: string;
	title: string;
	text: string;
	layout?: Record<string, unknown>;
	line?: boolean;
}): Cell {
	const { id, title, text, layout = {}, line = false } = options;
	return {
		title,
		build: (x, y) => ({
			sources: {
				[id]: collection([
					feature(
						line
							? {
									type: 'LineString',
									coordinates: [
										[x - 0.021, y - 0.004],
										[x + 0.021, y + 0.004],
									],
								}
							: { type: 'Point', coordinates: [x, y] },
					),
				]),
			},
			layers: [
				...(line
					? [
							{
								id: `${id}-line`,
								type: 'line' as const,
								source: id,
								paint: { 'line-color': '#bbbbbb', 'line-width': 2 },
							},
						]
					: []),
				{
					id,
					type: 'symbol',
					source: id,
					layout: {
						'text-field': text,
						'text-font': ['noto_sans_regular'],
						'text-size': 24,
						'text-allow-overlap': true,
						...(line && { 'symbol-placement': 'line' }),
						...layout,
					},
					paint: {
						'text-color': '#000000',
						'text-halo-color': '#ffcc00',
						'text-halo-width': 2,
					},
				},
			],
		}),
	};
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	// "Herzl Street"
	scriptCell({
		id: 'script-hebrew-line',
		title: 'Hebrew along a line',
		text: 'רחוב הרצל',
		line: true,
	}),
	scriptCell({
		id: 'script-mixed',
		title: 'Hebrew, Latin, brackets',
		text: 'Tel Aviv (תל אביב)',
	}),
	// "Tahrir Street"
	scriptCell({
		id: 'script-arabic-line',
		title: 'Arabic along a line',
		text: 'شارع التحرير',
		line: true,
	}),
	// "al-Qāhira", Cairo
	scriptCell({ id: 'script-arabic', title: 'Arabic', text: 'القاهرة' }),
	scriptCell({ id: 'script-bilingual', title: 'Arabic over Latin', text: 'القاهرة\nCairo' }),
	// "Pol-e Gisha", Tehran: letters only Persian has (peh, gaf, farsi yeh)
	scriptCell({ id: 'script-persian', title: 'Persian', text: 'پل گیشا' }),
	// "Ring Road 90"
	scriptCell({
		id: 'script-arabic-digits-line',
		title: 'Arabic with digits along a line',
		text: 'طريق 90 الدائري',
		line: true,
	}),
	// "Great 26th of July Street", broken into two lines
	scriptCell({
		id: 'script-arabic-lines',
		title: 'Arabic on several lines',
		text: 'شارع 26 يوليو الكبير',
		layout: { 'text-max-width': 4 },
	}),
	// Cursive: the spacing is left out, as MapLibre leaves it out.
	scriptCell({
		id: 'script-arabic-spacing',
		title: 'Arabic with letter spacing',
		text: 'القاهرة',
		layout: { 'text-letter-spacing': 0.3 },
	}),
];

export function scriptsStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
	});
}
