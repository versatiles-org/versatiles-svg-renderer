/**
 * Sprite images repeated along lines (`line-pattern`) and over areas, one per cell:
 *
 * | line-pattern             | turns (miter joins)      | round joins and caps       |
 * | on a polygon             | zoom-dependent width     | translucent                |
 * | data-driven, missing one | going west, then south   | fill-pattern               |
 *
 * The test sprite's shield (see `test-sprite.ts`) differs on every side, so a pattern
 * that runs the wrong way or has its top on the wrong side shows.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Position } from 'geojson';
import { box, collection, feature, gridStyle, type Cell } from './grid.js';
import { TEST_SPRITE_URL } from './test-sprite.js';

/** A cell with one line through `coordinates`, drawn with `paint` and `layout`. */
function lineCell(
	title: string,
	id: string,
	coordinates: (x: number, y: number) => Position[],
	paint: Record<string, unknown>,
	layout: Record<string, unknown> = {},
): Cell {
	return {
		title,
		build: (x, y) => ({
			sources: {
				[id]: collection([feature({ type: 'LineString', coordinates: coordinates(x, y) })]),
			},
			layers: [{ id, type: 'line', source: id, paint, layout } as never],
		}),
	};
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	lineCell(
		'line-pattern',
		'line-pattern',
		(x, y) => [
			[x - 0.014, y],
			[x + 0.014, y],
		],
		{ 'line-pattern': 'test:shield', 'line-width': 24 },
		{ 'line-cap': 'butt' },
	),
	lineCell(
		'turns (miter joins)',
		'line-pattern-turns',
		(x, y) => [
			[x - 0.014, y - 0.008],
			[x - 0.005, y + 0.008],
			[x + 0.004, y - 0.008],
			[x + 0.014, y + 0.006],
		],
		{ 'line-pattern': 'test:shield', 'line-width': 16 },
		{ 'line-join': 'miter' },
	),
	lineCell(
		'round joins and caps',
		'line-pattern-round',
		(x, y) => [
			[x - 0.013, y - 0.006],
			[x - 0.004, y + 0.008],
			[x + 0.006, y + 0.008],
			[x + 0.013, y - 0.006],
		],
		{ 'line-pattern': 'test:arrow', 'line-width': 16 },
		{ 'line-join': 'round', 'line-cap': 'round' },
	),
	{
		title: 'on a polygon',
		build: (x, y) => ({
			sources: { 'line-pattern-polygon': collection([feature(box(x, y, 0.009))]) },
			layers: [
				{
					id: 'line-pattern-polygon',
					type: 'line',
					source: 'line-pattern-polygon',
					paint: { 'line-pattern': 'test:shield', 'line-width': 20 },
				},
			],
		}),
	},
	// Drawn with the width at the zoom level's integer part: the renderers' regions at
	// fractional zoom levels show whether the copies are as long as MapLibre's.
	lineCell(
		'zoom-dependent width',
		'line-pattern-zoom-width',
		(x, y) => [
			[x - 0.014, y - 0.004],
			[x + 0.014, y + 0.004],
		],
		{
			'line-pattern': 'test:shield',
			'line-width': ['interpolate', ['linear'], ['zoom'], 11, 8, 13, 32],
		},
	),
	{
		// On a dark backdrop, so the translucency shows.
		title: 'translucent',
		build: (x, y) => ({
			sources: {
				'line-pattern-backdrop': collection([feature(box(x, y, 0.006))]),
				'line-pattern-translucent': collection([
					feature({
						type: 'LineString',
						coordinates: [
							[x - 0.014, y],
							[x + 0.014, y],
						],
					}),
				]),
			},
			layers: [
				{
					id: 'line-pattern-backdrop',
					type: 'fill',
					source: 'line-pattern-backdrop',
					paint: { 'fill-color': '#333333' },
				},
				{
					id: 'line-pattern-translucent',
					type: 'line',
					source: 'line-pattern-translucent',
					paint: { 'line-pattern': 'test:shield', 'line-width': 24, 'line-opacity': 0.5 },
				},
			],
		}),
	},
	{
		// The upper line names its image in a property; the lower one names a missing image,
		// and is not drawn.
		title: 'data-driven, missing one',
		build: (x, y) => ({
			sources: {
				'line-pattern-data': collection(
					['test:arrow', 'test:missing'].map((pattern, i) =>
						feature(
							{
								type: 'LineString',
								coordinates: [
									[x - 0.014, y + 0.005 - i * 0.01],
									[x + 0.014, y + 0.005 - i * 0.01],
								],
							},
							{ pattern },
						),
					),
				),
			},
			layers: [
				{
					id: 'line-pattern-data',
					type: 'line',
					source: 'line-pattern-data',
					paint: { 'line-pattern': ['get', 'pattern'], 'line-width': 16 },
				},
			],
		}),
	},
	lineCell(
		'going west, then south',
		'line-pattern-west',
		(x, y) => [
			[x + 0.014, y + 0.008],
			[x - 0.008, y + 0.008],
			[x - 0.008, y - 0.01],
		],
		{ 'line-pattern': 'test:shield', 'line-width': 20 },
	),
	{
		title: 'fill-pattern',
		build: (x, y) => ({
			sources: { 'fill-pattern-plain': collection([feature(box(x, y, 0.01))]) },
			layers: [
				{
					id: 'fill-pattern-plain',
					type: 'fill',
					source: 'fill-pattern-plain',
					paint: { 'fill-pattern': 'test:plain' },
				},
			],
		}),
	},
];

export function patternsStyle(): StyleSpecification {
	return gridStyle(cells, { sprite: [{ id: 'test', url: TEST_SPRITE_URL }] });
}
