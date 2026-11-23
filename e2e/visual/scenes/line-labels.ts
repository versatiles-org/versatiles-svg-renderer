/**
 * Labels along lines where MapLibre places them by more than the line itself, one case per
 * cell: it joins the ways of a street that meet end to start (`merge_lines.ts`), labels two
 * carriageways of one street once (`anchorIsTooClose`), spaces labels by their size at zoom 18
 * (`getAnchors`), and tests them for collisions by circles along them (`placeCollisionCircles`).
 *
 * | split way, joined          | roundabout of four arcs   | split way, one reversed   |
 * | three parts out of order   | text-size by zoom         | two carriageways          |
 * | diagonal streets, circles  |                           |                           |
 *
 * Each line lies on one side of 0°, a tile border at zoom 12, where MapLibre would place a
 * label on each tile's part of the line.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { collection, feature, gridStyle, type Cell } from './grid.js';

type Line = [number, number][];

/** Lines, each a feature of its own, labelled `text` along them. */
function lineCell(options: {
	id: string;
	title: string;
	text: string;
	lines: (x: number, y: number) => Line[];
	layout?: Record<string, unknown>;
}): Cell {
	const { id, title, text, lines, layout = {} } = options;
	return {
		title,
		build: (x, y) => ({
			sources: {
				[id]: collection(
					lines(x, y).map((coordinates) => feature({ type: 'LineString', coordinates })),
				),
			},
			layers: [
				{
					id: `${id}-line`,
					type: 'line',
					source: id,
					paint: { 'line-color': '#bbbbbb', 'line-width': 2 },
				},
				{
					id,
					type: 'symbol',
					source: id,
					layout: {
						'text-field': text,
						'text-font': ['noto_sans_regular'],
						'text-size': 20,
						'text-allow-overlap': true,
						'symbol-placement': 'line',
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

/** A straight line from `[x0, y]` to `[x1, y]` cut into `parts` lines end to start. */
function split(x0: number, x1: number, y: number, parts: number): Line[] {
	const xs = Array.from({ length: parts + 1 }, (_, i) => x0 + ((x1 - x0) * i) / parts);
	return xs.slice(1).map((x, i): Line => [
		[xs[i]!, y],
		[x, y],
	]);
}

/** A circle around `[x, y]`, cut into four arcs end to start, which share their ends. */
function roundabout(x: number, y: number, radius: number): Line[] {
	const points = Array.from({ length: 32 }, (_, i): [number, number] => {
		const angle = (i / 32) * 2 * Math.PI;
		return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
	});
	points.push(points[0]!);
	return [0, 8, 16, 24].map((start) => points.slice(start, start + 9));
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	// Each half is too short for the label; joined, they fit it once.
	lineCell({
		id: 'line-joined',
		title: 'split way, joined',
		text: 'Joined Street',
		lines: (x, y) => split(x - 0.015, x + 0.015, y, 2),
	}),
	lineCell({
		id: 'line-roundabout',
		title: 'roundabout of four arcs',
		text: 'Ring Road',
		lines: (x, y) => roundabout(x + 0.011, y, 0.008),
		layout: { 'text-size': 16 },
	}),
	// One half runs the other way: MapLibre joins end to start only, so no label fits.
	lineCell({
		id: 'line-reversed',
		title: 'split way, one reversed',
		text: 'Joined Street',
		lines: (x, y) => {
			const [first, second] = split(x - 0.015, x + 0.015, y, 2);
			return [first!, [...second!].reverse()];
		},
	}),
	// The middle part comes last: it joins the two others.
	lineCell({
		id: 'line-three',
		title: 'three parts out of order',
		text: 'Joined Street',
		lines: (x, y) => {
			const [a, b, c] = split(x - 0.015, x + 0.015, y + 0.008, 3);
			return [a!, c!, b!];
		},
	}),
	// 12 px now, 36 px at zoom 18: spaced and fitted as 36 px, so in the middle of the line.
	lineCell({
		id: 'line-size-by-zoom',
		title: 'text-size by zoom',
		text: 'Main',
		lines: (x, y) => [
			[
				[x + 0.001, y + 0.008],
				[x + 0.021, y + 0.008],
			],
		],
		layout: { 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12, 18, 36] },
	}),
	// The labels of the second, 7 px from the first, are too close to the first's.
	lineCell({
		id: 'line-carriageways',
		title: 'two carriageways',
		text: 'Twin Street',
		lines: (x, y) => [
			[
				[x - 0.02, y + 0.008],
				[x + 0.02, y + 0.008],
			],
			[
				[x - 0.02, y + 0.0092],
				[x + 0.02, y + 0.0092],
			],
		],
		layout: { 'text-size': 14 },
	}),
	// Two diagonal streets 30 px apart, each label in its layer and blocking the other's way:
	// MapLibre tests them by circles 14 px in radius along them, which leave room for both,
	// where the boxes around each turned glyph would reach 20 px to either side.
	{
		title: 'diagonal streets, circles',
		build: (x, y) => {
			const diagonal = (id: string, text: string, shift: number) =>
				lineCell({
					id,
					title: id,
					text,
					lines: () => [
						[
							[x - 0.012 + shift, y - 0.012],
							[x + 0.012 + shift, y + 0.012],
						],
					],
					layout: { 'text-allow-overlap': false },
				}).build(x, y);
			const upper = diagonal('line-diagonal-upper', 'Upper Street', 0);
			const lower = diagonal('line-diagonal-lower', 'Lower Street', 0.00726);
			return {
				sources: { ...upper.sources, ...lower.sources },
				layers: [...upper.layers, ...lower.layers],
			};
		},
	},
];

export function lineLabelsStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
	});
}
