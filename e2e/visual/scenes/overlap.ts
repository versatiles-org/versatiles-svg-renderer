/**
 * Labels and icons that may or may not overlap others (`text-overlap`, `icon-overlap`), one
 * stack per cell. Each label's text names its mode; labels 14 px apart overlap, 40 px apart
 * they do not. Layers are listed as they are placed: the first one first, so it is the last
 * in the style.
 *
 * | never beats allow-overlap | always                   | cooperative among selves |
 * | cooperative, never above  | cooperative, always above | variable anchors          |
 * | icons, cooperative        |                          |                          |
 */
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { collection, feature, gridStyle, type Cell } from './grid.js';
import { TEST_SPRITE_URL } from './test-sprite.js';

/** About the size of 5.8 px at zoom 12, in degrees. */
const PX = 0.001 / 5.8;

interface Stack {
	/** Where each symbol goes, in pixels from the cell's center (y down), placed in order. */
	at: [number, number][];
	layout: Record<string, unknown>;
	/** Each symbol's text; none draws icons only. */
	text?: string;
}

/** A cell of stacks of symbols, placed one stack after the other. */
function overlapCell(options: { id: string; title: string; stacks: Stack[] }): Cell {
	const { id, title, stacks } = options;
	return {
		title,
		build: (x, y) => {
			const sources: Record<string, ReturnType<typeof collection>> = {};
			const layers: LayerSpecification[] = stacks.map(({ at, layout, text }, i) => {
				const source = `${id}-${String(i)}`;
				sources[source] = collection(
					at.map(([dx, dy], j) =>
						feature(
							{ type: 'Point', coordinates: [x + dx * PX, y - dy * PX] },
							{ name: `${text ?? ''} ${String(j + 1)}` },
						),
					),
				);
				return {
					id: source,
					type: 'symbol',
					source,
					layout: {
						...(text
							? {
									'text-field': ['get', 'name'],
									'text-font': ['noto_sans_regular'],
									'text-size': 20,
								}
							: { 'icon-image': 'test:shield', 'icon-size': 1.5 }),
						...layout,
					},
					paint: { 'text-color': '#000000' },
				};
			});
			// The first stack is placed first: it is drawn on top, last in the style.
			return { sources, layers: layers.reverse() };
		},
	};
}

/** Three symbols, each overlapping the one before. */
const OVERLAPPING: [number, number][] = [
	[0, -14],
	[12, 0],
	[24, 14],
];

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	// `text-overlap` wins over `text-allow-overlap`: the second label, over the others, is hidden.
	overlapCell({
		id: 'overlap-never',
		title: 'never beats allow-overlap',
		stacks: [
			{
				text: 'never',
				at: OVERLAPPING,
				layout: { 'text-overlap': 'never', 'text-allow-overlap': true },
			},
		],
	}),
	overlapCell({
		id: 'overlap-always',
		title: 'always',
		stacks: [{ text: 'always', at: OVERLAPPING, layout: { 'text-overlap': 'always' } }],
	}),
	overlapCell({
		id: 'overlap-cooperative',
		title: 'cooperative among selves',
		stacks: [{ text: 'coop', at: OVERLAPPING, layout: { 'text-overlap': 'cooperative' } }],
	}),
	// The first cooperative label overlaps the "never" one and is hidden; the others are not
	// over it, so they are shown, over each other.
	overlapCell({
		id: 'overlap-under-never',
		title: 'cooperative, never above',
		stacks: [
			{ text: 'never', at: [[0, -30]], layout: {} },
			{
				text: 'coop',
				at: [
					[0, -16],
					[0, 10],
					[12, 24],
				],
				layout: { 'text-overlap': 'cooperative' },
			},
		],
	}),
	// Over an "always" label, a cooperative one is shown and a "never" one is not.
	overlapCell({
		id: 'overlap-under-always',
		title: 'cooperative, always above',
		stacks: [
			{ text: 'always', at: [[0, -20]], layout: { 'text-allow-overlap': true } },
			{ text: 'coop', at: [[12, -6]], layout: { 'text-overlap': 'cooperative' } },
			{ text: 'never', at: [[24, 8]], layout: {} },
		],
	}),
	// Below and above the point are taken by a "never" label, right of it by an "always" one:
	// the label goes right, over the "always" one, as no place is free.
	overlapCell({
		id: 'overlap-anchors',
		title: 'variable anchors',
		stacks: [
			{ text: 'never', at: [[0, 32]], layout: {} },
			{ text: 'never', at: [[0, -32]], layout: {} },
			{ text: 'always', at: [[60, 0]], layout: { 'text-allow-overlap': true } },
			{
				text: 'coop',
				at: [[0, 0]],
				layout: {
					'text-overlap': 'cooperative',
					'text-variable-anchor': ['top', 'bottom', 'left'],
					'text-radial-offset': 0.8,
				},
			},
		],
	}),
	// Icons, 72 px wide: a cooperative one overlaps an "always" one, but not a "never" one.
	overlapCell({
		id: 'overlap-icons',
		title: 'icons, cooperative',
		stacks: [
			{ at: [[-50, 0]], layout: {} },
			{ at: [[50, 0]], layout: { 'icon-allow-overlap': true } },
			{
				at: [
					[-38, 10],
					[38, 10],
				],
				layout: { 'icon-overlap': 'cooperative' },
			},
		],
	}),
];

/** The scene's style. */
export function overlapStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
		sprite: [{ id: 'test', url: TEST_SPRITE_URL }],
	});
}
