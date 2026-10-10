/**
 * Dashed lines (`line-dasharray`), one check per cell:
 *
 * | thin, short dashes   | butt caps, turns       | round caps and joins |
 * | on a polygon         | zoom-dependent width   | translucent          |
 * | odd number of values | going west, then south | square caps          |
 *
 * MapLibre measures the dashes in line widths at the zoom level's integer part, scaled with
 * the map from there, and from the start of every line: the regions at a fractional zoom
 * level and on a turned map show whether the renderers' dashes are where MapLibre's are.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Position } from 'geojson';
import { box, collection, feature, gridStyle, type Cell } from './grid.js';

const COLOR = '#335577';

/** A cell with lines through each of `lines`, drawn with `paint` and `layout`. */
function lineCell(
	title: string,
	id: string,
	lines: (x: number, y: number) => Position[][],
	paint: Record<string, unknown>,
	layout: Record<string, unknown> = {},
): Cell {
	return {
		title,
		build: (x, y) => ({
			sources: {
				[id]: collection(
					lines(x, y).map((coordinates) => feature({ type: 'LineString', coordinates })),
				),
			},
			layers: [
				{ id, type: 'line', source: id, paint: { 'line-color': COLOR, ...paint }, layout } as never,
			],
		}),
	};
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	// As the paths of the VersaTiles styles: dashes shorter than two pixels, where being off
	// by half a pixel shows all along the line.
	lineCell(
		'thin, short dashes',
		'dash-thin',
		(x, y) => [
			[
				[x - 0.014, y + 0.009],
				[x + 0.014, y + 0.009],
			],
			[
				[x - 0.014, y + 0.006],
				[x + 0.014, y + 0.003],
			],
			[
				[x - 0.014, y - 0.01],
				[x + 0.006, y + 0.001],
				[x + 0.014, y - 0.01],
			],
			[
				[x - 0.012, y + 0.001],
				[x - 0.008, y - 0.002],
				[x - 0.003, y - 0.003],
				[x + 0.002, y - 0.007],
				[x + 0.004, y - 0.011],
			],
		],
		{ 'line-width': 1, 'line-dasharray': [1.5, 0.75] },
		{ 'line-cap': 'butt' },
	),
	lineCell(
		'butt caps, turns',
		'dash-butt',
		(x, y) => [
			[
				[x - 0.014, y - 0.008],
				[x - 0.005, y + 0.008],
				[x + 0.004, y - 0.008],
				[x + 0.014, y + 0.006],
			],
		],
		{ 'line-width': 6, 'line-dasharray': [2, 1] },
		{ 'line-cap': 'butt', 'line-join': 'miter' },
	),
	lineCell(
		'round caps and joins',
		'dash-round',
		(x, y) => [
			[
				[x - 0.013, y - 0.006],
				[x - 0.004, y + 0.008],
				[x + 0.006, y + 0.008],
				[x + 0.013, y - 0.006],
			],
		],
		{ 'line-width': 6, 'line-dasharray': [1, 2.5] },
		{ 'line-cap': 'round', 'line-join': 'round' },
	),
	{
		title: 'on a polygon',
		build: (x, y) => ({
			sources: { 'dash-polygon': collection([feature(box(x, y, 0.009))]) },
			layers: [
				{
					id: 'dash-polygon',
					type: 'line',
					source: 'dash-polygon',
					paint: { 'line-color': COLOR, 'line-width': 4, 'line-dasharray': [3, 2] },
				},
			],
		}),
	},
	// Measured in the width at the zoom level's integer part.
	lineCell(
		'zoom-dependent width',
		'dash-zoom-width',
		(x, y) => [
			[
				[x - 0.014, y - 0.004],
				[x + 0.014, y + 0.004],
			],
		],
		{
			'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 13, 10],
			'line-dasharray': [2, 1],
		},
	),
	{
		// On a dark backdrop, so the translucency shows.
		title: 'translucent',
		build: (x, y) => ({
			sources: {
				'dash-backdrop': collection([feature(box(x, y, 0.006))]),
				'dash-translucent': collection([
					feature({
						type: 'LineString',
						coordinates: [
							[x - 0.014, y - 0.003],
							[x + 0.014, y + 0.003],
						],
					}),
				]),
			},
			layers: [
				{
					id: 'dash-backdrop',
					type: 'fill',
					source: 'dash-backdrop',
					paint: { 'fill-color': '#333333' },
				},
				{
					id: 'dash-translucent',
					type: 'line',
					source: 'dash-translucent',
					paint: {
						'line-color': '#ffcc00',
						'line-width': 8,
						'line-opacity': 0.5,
						'line-dasharray': [1.5, 1],
					},
				},
			],
		}),
	},
	// MapLibre joins the last dash of an odd number of values to the first.
	lineCell(
		'odd number of values',
		'dash-odd',
		(x, y) => [
			[
				[x - 0.014, y + 0.004],
				[x + 0.014, y + 0.004],
			],
			[
				[x - 0.014, y - 0.006],
				[x + 0.014, y - 0.002],
			],
		],
		{ 'line-width': 5, 'line-dasharray': [3, 1, 1] },
	),
	lineCell(
		'going west, then south',
		'dash-west',
		(x, y) => [
			[
				[x + 0.014, y + 0.008],
				[x - 0.008, y + 0.008],
				[x - 0.008, y - 0.01],
			],
		],
		{ 'line-width': 4, 'line-dasharray': [4, 1.5] },
	),
	// MapLibre draws square caps at a line's ends only: its dashes end flat.
	lineCell(
		'square caps',
		'dash-square',
		(x, y) => [
			[
				[x - 0.012, y - 0.006],
				[x, y + 0.006],
				[x + 0.012, y - 0.006],
			],
		],
		{ 'line-width': 6, 'line-dasharray': [2, 2] },
		{ 'line-cap': 'square' },
	),
];

export function dashesStyle(): StyleSpecification {
	return gridStyle(cells);
}
