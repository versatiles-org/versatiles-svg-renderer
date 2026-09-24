/**
 * Sources other than tiles and inline GeoJSON, one per cell:
 *
 * | image                  | skewed image (parallelogram)     | image in perspective |
 * | translucent image      | strongly foreshortened image     | mirrored image       |
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
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
];

export function sourcesStyle(): StyleSpecification {
	return gridStyle(cells);
}
