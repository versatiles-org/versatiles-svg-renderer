/**
 * Labels with several places to go (`text-variable-anchor`, `text-variable-anchor-offset`)
 * and `text-radial-offset`, one per cell. A red dot marks each label's point; translucent
 * checkerboards, placed first, block some of the places, so the label moves on.
 *
 * | first place free          | first place blocked     | all blocked: hidden     |
 * | all blocked, may overlap  | radial offset only      | variable-anchor-offset  |
 * | fitted icon moves along   | two lines, justified    | icon stays, not fitted  |
 */
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { collection, feature, gridStyle, type Cell } from './grid.js';
import { TEST_SPRITE_URL } from './test-sprite.js';

/** About the size of 5.8 px at zoom 12, in degrees. */
const PX = 0.001 / 5.8;

/**
 * A cell with a label at its center, laid out by `layout`, and blockers: checkerboards of
 * `size` (a multiple of 32 px) at `[dx, dy]` pixels from the label's point (y down).
 */
function anchorCell(options: {
	id: string;
	title: string;
	text?: string;
	layout: Record<string, unknown>;
	blockers?: { at: [number, number]; size?: number }[];
}): Cell {
	const { id, title, text = 'Label', layout, blockers = [] } = options;
	return {
		title,
		build: (x, y) => {
			const layers: LayerSpecification[] = [
				{
					id: `${id}-point`,
					type: 'circle',
					source: id,
					paint: { 'circle-color': '#ff0000', 'circle-radius': 3 },
				},
				{
					id,
					type: 'symbol',
					source: id,
					layout: {
						'text-field': text,
						'text-font': ['noto_sans_regular'],
						'text-size': 20,
						...layout,
					},
					paint: { 'text-color': '#000000' },
				},
			];
			const sources: Record<string, ReturnType<typeof collection>> = {
				[id]: collection([feature({ type: 'Point', coordinates: [x, y] })]),
			};
			if (blockers.length > 0) {
				sources[`${id}-blockers`] = collection(
					blockers.map(({ at: [dx, dy], size = 1 }) =>
						feature({ type: 'Point', coordinates: [x + dx * PX, y - dy * PX] }, { size }),
					),
				);
				// Above the label's layer, so placed before it.
				layers.push({
					id: `${id}-blockers`,
					type: 'symbol',
					source: `${id}-blockers`,
					layout: {
						'icon-image': 'test:plain',
						'icon-size': ['get', 'size'],
						'icon-allow-overlap': true,
					},
					// Translucent, so a label below one shows.
					paint: { 'icon-opacity': 0.4 },
				});
			}
			return { sources, layers };
		},
	};
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	anchorCell({
		id: 'anchor-first',
		title: 'first place free',
		layout: { 'text-variable-anchor': ['top', 'bottom'], 'text-radial-offset': 0.5 },
	}),
	// Below the point is taken: the label goes above it.
	anchorCell({
		id: 'anchor-second',
		title: 'first place blocked',
		layout: { 'text-variable-anchor': ['top', 'bottom'], 'text-radial-offset': 0.5 },
		blockers: [{ at: [0, 28] }],
	}),
	anchorCell({
		id: 'anchor-hidden',
		title: 'all blocked: hidden',
		layout: { 'text-variable-anchor': ['left', 'right', 'top', 'bottom'] },
		blockers: [{ at: [0, 0], size: 5 }],
	}),
	anchorCell({
		id: 'anchor-overlap',
		title: 'all blocked, may overlap',
		layout: {
			'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
			'text-allow-overlap': true,
		},
		blockers: [{ at: [0, 0], size: 5 }],
	}),
	anchorCell({
		id: 'anchor-radial',
		title: 'radial offset only',
		layout: { 'text-anchor': 'top-left', 'text-radial-offset': 2 },
	}),
	// Right of the point is taken: the label goes left of it.
	anchorCell({
		id: 'anchor-offsets',
		title: 'variable-anchor-offset',
		layout: { 'text-variable-anchor-offset': ['left', [1, 0], 'right', [-1, 0]] },
		blockers: [{ at: [45, 0] }],
	}),
	anchorCell({
		id: 'anchor-fitted',
		title: 'fitted icon moves along',
		layout: {
			'text-variable-anchor': ['top', 'bottom'],
			'text-radial-offset': 1,
			'icon-image': 'test:shield',
			'icon-text-fit': 'both',
			'icon-text-fit-padding': [4, 8, 4, 8],
		},
		blockers: [{ at: [0, 40] }],
	}),
	// Right of the point is taken: the two lines go left of it, justified to the right.
	anchorCell({
		id: 'anchor-lines',
		title: 'two lines, justified',
		text: 'A longer label',
		layout: {
			'text-variable-anchor': ['left', 'right'],
			'text-radial-offset': 1,
			'text-max-width': 5,
		},
		blockers: [{ at: [60, 0] }],
	}),
	anchorCell({
		id: 'anchor-icon',
		title: 'icon stays, not fitted',
		layout: {
			'text-variable-anchor': ['top', 'bottom'],
			'text-radial-offset': 1.5,
			'icon-image': 'test:arrow',
		},
		blockers: [{ at: [0, 45] }],
	}),
];

export function anchorsStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
		sprite: [{ id: 'test', url: TEST_SPRITE_URL }],
	});
}
