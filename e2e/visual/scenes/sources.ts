/**
 * Source types and source options, one per cell:
 *
 * | image                  | skewed image (parallelogram)     | image in perspective |
 * | translucent image      | strongly foreshortened image     | mirrored image       |
 * | GeoJSON filter         | GeoJSON promoteId                | GeoJSON generateId   |
 */
import type { ExpressionSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from 'geojson';
import { box, collection, feature, gridStyle, type Cell } from './grid.js';
import { TEST_IMAGE_URL } from './test-image.js';

type Corners = [[number, number], [number, number], [number, number], [number, number]];

/** A cell drawing the test image at `corners` (top left, top right, bottom right, bottom left). */
function imageCell(
	title: string,
	id: string,
	corners: (x: number, y: number) => Corners,
	backdrop?: string,
	opacity?: number,
): Cell {
	return {
		title,
		build: (x, y) => ({
			sources: {
				...(backdrop ? { [`${id}-backdrop`]: collection([feature(box(x, y, 0.008))]) } : {}),
				[id]: { type: 'image', url: TEST_IMAGE_URL, coordinates: corners(x, y) },
			},
			layers: [
				...(backdrop
					? [
							{
								id: `${id}-backdrop`,
								type: 'fill' as const,
								source: `${id}-backdrop`,
								paint: { 'fill-color': backdrop },
							},
						]
					: []),
				{
					id,
					type: 'raster',
					source: id,
					paint: opacity === undefined ? {} : { 'raster-opacity': opacity },
				},
			],
		}),
	};
}

/**
 * Six squares in two rows around the cell's center, from the top left, with `properties`
 * each (and an `id`, if given).
 */
function squares(x: number, y: number, properties: Record<string, unknown>[]): Feature[] {
	return properties.map(({ id, ...props }, i) => ({
		...feature(
			box(x - 0.012 + (i % 3) * 0.012, y + 0.006 - Math.floor(i / 3) * 0.012, 0.0045),
			props,
		),
		...(id === undefined ? {} : { id: id as string | number }),
	}));
}

/** Colors a square by its id, as `['id']` reads it: 0 to 5, else grey. */
const BY_ID: ExpressionSpecification = [
	'match',
	['id'],
	0,
	'#d7191c',
	1,
	'#fdae61',
	2,
	'#1b7837',
	3,
	'#2c7bb6',
	4,
	'#762a83',
	5,
	'#000000',
	'#bbbbbb',
];

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	imageCell('image', 'image', (x, y) => [
		[x - 0.016, y + 0.012],
		[x + 0.016, y + 0.012],
		[x + 0.016, y - 0.012],
		[x - 0.016, y - 0.012],
	]),
	imageCell('skewed image', 'image-skewed', (x, y) => [
		[x - 0.01, y + 0.012],
		[x + 0.018, y + 0.008],
		[x + 0.01, y - 0.012],
		[x - 0.018, y - 0.008],
	]),
	// Half as wide at the top as at the bottom: warped projectively, as in perspective.
	imageCell('image in perspective', 'image-perspective', (x, y) => [
		[x - 0.009, y + 0.012],
		[x + 0.009, y + 0.012],
		[x + 0.018, y - 0.012],
		[x - 0.018, y - 0.012],
	]),
	// On a dark backdrop, so the translucency shows.
	imageCell(
		'translucent image',
		'image-translucent',
		(x, y) => [
			[x - 0.016, y + 0.012],
			[x + 0.016, y + 0.012],
			[x + 0.016, y - 0.012],
			[x - 0.016, y - 0.012],
		],
		'#333333',
		0.6,
	),
	// Fifteen times as wide at the bottom as at the top: MapLibre blends the projective warp
	// towards the bilinear one.
	imageCell('strongly foreshortened image', 'image-foreshortened', (x, y) => [
		[x - 0.001, y + 0.012],
		[x + 0.001, y + 0.012],
		[x + 0.015, y - 0.012],
		[x - 0.015, y - 0.012],
	]),
	// East and west swapped: the image is drawn mirrored.
	imageCell('mirrored image', 'image-mirrored', (x, y) => [
		[x + 0.016, y + 0.012],
		[x - 0.016, y + 0.012],
		[x - 0.016, y - 0.012],
		[x + 0.016, y - 0.012],
	]),
	// The source's filter keeps the squares of kind "a": the first, third, fifth.
	{
		title: 'GeoJSON filter',
		build: (x, y) => ({
			sources: {
				filtered: {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: squares(
							x,
							y,
							['a', 'b', 'a', 'b', 'a', 'b'].map((kind) => ({ kind })),
						),
					},
					filter: ['==', ['get', 'kind'], 'a'],
				},
			},
			layers: [
				{
					id: 'geojson-filter',
					type: 'fill',
					source: 'filtered',
					paint: { 'fill-color': '#2c7bb6' },
				},
			],
		}),
	},
	// Paint properties see `ref` as the id, as it is: the numbers 0 and 1; strings, even
	// numeric ones, and a missing `ref` match no number (grey). The features' own ids are
	// ignored. (Filters would see the numeric strings as integers.)
	{
		title: 'GeoJSON promoteId',
		build: (x, y) => ({
			sources: {
				promoted: {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: squares(x, y, [
							{ id: 5, ref: 0 },
							{ id: 5, ref: 1 },
							{ id: 5, ref: '2' },
							{ id: 5, ref: '3.9' },
							{ id: 5, ref: 'four' },
							{ id: 5 },
						]),
					},
					promoteId: 'ref',
				},
			},
			layers: [
				{
					id: 'geojson-promote-id',
					type: 'fill',
					source: 'promoted',
					paint: { 'fill-color': BY_ID },
				},
			],
		}),
	},
	// Ids are the index among the features that pass the filter: the squares of kind "b"
	// are left out, so the rest count 0, 1, 2, 3.
	{
		title: 'GeoJSON generateId',
		build: (x, y) => ({
			sources: {
				generated: {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: squares(
							x,
							y,
							['a', 'b', 'a', 'a', 'b', 'a'].map((kind) => ({ id: 5, kind })),
						),
					},
					filter: ['==', ['get', 'kind'], 'a'],
					generateId: true,
				},
			},
			layers: [
				{
					id: 'geojson-generate-id',
					type: 'fill',
					source: 'generated',
					paint: { 'fill-color': BY_ID },
				},
			],
		}),
	},
];

export function sourcesStyle(): StyleSpecification {
	return gridStyle(cells);
}
