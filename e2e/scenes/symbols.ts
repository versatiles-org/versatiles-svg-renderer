/**
 * Icons fitted to their labels (`icon-text-fit`), stretched by the stretch zones of the
 * test sprite (see `test-sprite.ts`), and a turned icon, one per cell. Twice the usual size,
 * so that differences show.
 *
 * | fit both, padding     | fit width           | fit height, two lines     |
 * | plain image, fit both | fit both, icon-size | plain image, turned       |
 * | fit both, on a line   | turned icon, offset | fit both, anchor + offset |
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { collection, feature, gridStyle, type Cell } from './grid.js';
import { seedTestSprite, TEST_SPRITE_URL } from './test-sprite.js';

/**
 * A cell with one symbol: the test sprite's shield, and `text` if given, at the cell's
 * center, or along a line through it (drawn below, to see where it lies); `layout` adds to
 * and overrides that.
 */
function symbol(options: {
	id: string;
	title: string;
	text?: string;
	layout: Record<string, unknown>;
	line?: boolean;
}): Cell {
	const { id, title, text, layout, line = false } = options;
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
										[x - 0.02, y - 0.008],
										[x + 0.02, y + 0.008],
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
								paint: { 'line-color': '#999999', 'line-width': 2 },
							},
						]
					: []),
				{
					id,
					type: 'symbol',
					source: id,
					layout: {
						'icon-image': 'test:shield',
						'icon-allow-overlap': true,
						'text-allow-overlap': true,
						...(text && {
							'text-field': text,
							'text-font': ['noto_sans_regular'],
							'text-size': 28,
						}),
						...layout,
					},
					paint: { 'text-color': '#000000' },
				},
			],
		}),
	};
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	symbol({
		id: 'fit-both',
		title: 'fit both, padding',
		text: 'A 100',
		layout: { 'icon-text-fit': 'both', 'icon-text-fit-padding': [4, 8, 4, 8] },
	}),
	symbol({
		id: 'fit-width',
		title: 'fit width',
		text: 'Hauptstraße',
		layout: { 'icon-text-fit': 'width', 'icon-text-fit-padding': [0, 6, 0, 6] },
	}),
	symbol({
		id: 'fit-height',
		title: 'fit height, two lines',
		text: 'E 55\nNord',
		layout: { 'icon-text-fit': 'height', 'icon-text-fit-padding': [6, 0, 6, 0] },
	}),
	symbol({
		id: 'fit-plain',
		title: 'plain image, fit both',
		text: 'Stretch',
		layout: {
			'icon-image': 'test:plain',
			'icon-text-fit': 'both',
			'icon-text-fit-padding': [8, 8, 8, 8],
		},
	}),
	symbol({
		id: 'fit-size',
		title: 'fit both, icon-size',
		text: 'M 1',
		layout: { 'icon-text-fit': 'both', 'icon-size': 1.5 },
	}),
	// A plain image: MapLibre does not turn the fixed parts of a stretched one with it.
	symbol({
		id: 'fit-rotated',
		title: 'plain image, turned',
		text: 'R 20',
		layout: {
			'icon-image': 'test:plain',
			'icon-text-fit': 'both',
			'icon-text-fit-padding': [4, 8, 4, 8],
			'icon-rotate': 20,
			'text-rotate': 20,
		},
	}),
	symbol({
		id: 'fit-line',
		title: 'fit both, on a line',
		text: 'L 7',
		line: true,
		layout: {
			'symbol-placement': 'line-center',
			'text-rotation-alignment': 'viewport',
			'icon-rotation-alignment': 'viewport',
			'icon-text-fit': 'both',
			'icon-text-fit-padding': [4, 8, 4, 8],
		},
	}),
	symbol({
		id: 'rotated-icon',
		title: 'turned icon, offset',
		layout: {
			'icon-image': 'test:arrow',
			'icon-size': 2,
			'icon-offset': [12, 0],
			'icon-rotate': 60,
		},
	}),
	symbol({
		id: 'fit-anchor',
		title: 'fit both, anchor + offset',
		text: 'Left',
		layout: {
			'icon-text-fit': 'both',
			'icon-text-fit-padding': [4, 16, 4, 4],
			'text-anchor': 'left',
			'text-offset': [1, 0.5],
		},
	}),
];

/** The scene's style. Its sprite is served from the fetch cache, so this puts it there. */
export function symbolsStyle(): StyleSpecification {
	seedTestSprite();
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
		sprite: [{ id: 'test', url: TEST_SPRITE_URL }],
	});
}
