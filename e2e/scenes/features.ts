/**
 * Single features of fill, line and circle layers, one per cell:
 *
 * | fill-sort-key          | line-sort-key                | circle-sort-key            |
 * | circle opacities, blur | line-gap-width               | global-state               |
 * | fill-pattern           | translucent pattern, outline | small pattern, missing one |
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Geometry } from 'geojson';
import { box, collection, feature, gridStyle, type Cell } from './grid.js';

/**
 * Three overlapping shapes, in source order red, green, blue, with sort keys 3, 2, 1:
 * MapLibre draws blue first and red on top.
 */
function sortKeyed(make: (i: number) => Geometry) {
	const colors = ['#e41a1c', '#4daf4a', '#377eb8'];
	return collection(colors.map((color, i) => feature(make(i), { color, key: 3 - i })));
}

const cells: Cell[] = [
	{
		title: 'fill-sort-key',
		build: (x, y) => ({
			sources: {
				fills: sortKeyed((i) => box(x - 0.006 + i * 0.006, y + 0.006 - i * 0.006, 0.008)),
			},
			layers: [
				{
					id: 'fill-sort-key',
					type: 'fill',
					source: 'fills',
					layout: { 'fill-sort-key': ['get', 'key'] },
					paint: { 'fill-color': ['get', 'color'] },
				},
			],
		}),
	},
	{
		title: 'line-sort-key',
		build: (x, y) => ({
			sources: {
				lines: sortKeyed((i) => ({
					type: 'LineString',
					coordinates: [
						[x - 0.015, y + 0.012 - i * 0.012],
						[x + 0.015, y - 0.012 + i * 0.012],
					],
				})),
			},
			layers: [
				{
					id: 'line-sort-key',
					type: 'line',
					source: 'lines',
					layout: { 'line-sort-key': ['get', 'key'], 'line-cap': 'butt' },
					paint: { 'line-color': ['get', 'color'], 'line-width': 14 },
				},
			],
		}),
	},
	{
		title: 'circle-sort-key',
		build: (x, y) => ({
			sources: {
				circles: sortKeyed((i) => ({
					type: 'Point',
					coordinates: [x - 0.004 + i * 0.004, y + 0.003 - i * 0.003],
				})),
			},
			layers: [
				{
					id: 'circle-sort-key',
					type: 'circle',
					source: 'circles',
					layout: { 'circle-sort-key': ['get', 'key'] },
					paint: { 'circle-color': ['get', 'color'], 'circle-radius': 30 },
				},
			],
		}),
	},
	{
		// On a dark backdrop, so translucent fills and strokes show: above, circle-opacity
		// and circle-stroke-opacity; below, circle-blur, with and without a stroke.
		title: 'circle opacities, circle-blur',
		build: (x, y) => ({
			sources: {
				backdrop: collection([feature(box(x, y, 0.016))]),
				opacities: collection(
					[
						{ opacity: 0.5, strokeOpacity: 1 },
						{ opacity: 1, strokeOpacity: 0.4 },
						{ opacity: 0, strokeOpacity: 0.7 },
					].map((props, i) =>
						feature({ type: 'Point', coordinates: [x - 0.01 + i * 0.01, y + 0.0055] }, props),
					),
				),
				blurred: collection(
					[
						{ blur: 0.5, strokeWidth: 0, opacity: 1, strokeOpacity: 1 },
						{ blur: 1, strokeWidth: 8, opacity: 1, strokeOpacity: 1 },
						{ blur: 0.3, strokeWidth: 8, opacity: 0.6, strokeOpacity: 0.5 },
					].map((props, i) =>
						feature({ type: 'Point', coordinates: [x - 0.01 + i * 0.01, y - 0.0055] }, props),
					),
				),
			},
			layers: [
				{ id: 'backdrop', type: 'fill', source: 'backdrop', paint: { 'fill-color': '#333333' } },
				{
					id: 'circle-opacity',
					type: 'circle',
					source: 'opacities',
					paint: {
						'circle-color': '#ffaa00',
						'circle-radius': 18,
						'circle-opacity': ['get', 'opacity'],
						'circle-stroke-color': '#00ccff',
						'circle-stroke-width': 8,
						'circle-stroke-opacity': ['get', 'strokeOpacity'],
					},
				},
				{
					id: 'circle-blur',
					type: 'circle',
					source: 'blurred',
					paint: {
						'circle-color': '#ffaa00',
						'circle-radius': 18,
						'circle-blur': ['get', 'blur'],
						'circle-opacity': ['get', 'opacity'],
						'circle-stroke-color': '#00ccff',
						'circle-stroke-width': ['get', 'strokeWidth'],
						'circle-stroke-opacity': ['get', 'strokeOpacity'],
					},
				},
			],
		}),
	},
	{
		// A zigzag: round joins, one of them sharper than 120°.
		title: 'line-gap-width',
		build: (x, y) => ({
			sources: {
				gap: collection([
					feature({
						type: 'LineString',
						coordinates: [
							[x - 0.016, y - 0.008],
							[x - 0.006, y + 0.01],
							[x + 0.004, y - 0.01],
							[x + 0.016, y + 0.006],
						],
					}),
				]),
			},
			layers: [
				{
					id: 'line-gap-width',
					type: 'line',
					source: 'gap',
					layout: { 'line-cap': 'butt', 'line-join': 'round' },
					paint: { 'line-color': '#0055aa', 'line-width': 4, 'line-gap-width': 12 },
				},
			],
		}),
	},
	{
		// Three squares: the state picks one by `which` and colors it (paint), outlines it
		// (filter), and hides the third (visibility).
		title: 'global-state',
		build: (x, y) => ({
			sources: {
				state: collection([
					feature(box(x - 0.009, y + 0.006, 0.005), { which: 'shown' }),
					feature(box(x + 0.009, y + 0.006, 0.005), { which: 'filtered' }),
					feature(box(x, y - 0.01, 0.005), { which: 'hidden' }),
				]),
			},
			layers: [
				{
					id: 'global-state',
					type: 'fill',
					source: 'state',
					filter: ['!=', ['get', 'which'], 'hidden'],
					paint: {
						'fill-color': [
							'case',
							['==', ['get', 'which'], ['global-state', 'which']],
							['global-state', 'color'],
							'#dddddd',
						],
					},
				},
				{
					id: 'global-state-filter',
					type: 'line',
					source: 'state',
					filter: ['==', ['get', 'which'], ['global-state', 'which']],
					paint: { 'line-color': '#000000', 'line-width': 4 },
				},
				{
					id: 'global-state-visibility',
					type: 'fill',
					source: 'state',
					filter: ['==', ['get', 'which'], 'hidden'],
					layout: { visibility: ['case', ['global-state', 'hidden'], 'none', 'visible'] },
					paint: { 'fill-color': '#ff0000' },
				},
			],
		}),
	},
	{
		title: 'fill-pattern',
		build: (x, y) => ({
			sources: { hatched: collection([feature(box(x, y, 0.012))]) },
			layers: [
				{
					id: 'fill-pattern',
					type: 'fill',
					source: 'hatched',
					paint: { 'fill-pattern': 'base:pattern-hatched' },
				},
			],
		}),
	},
	{
		// On a yellow backdrop, so the pattern's translucency shows.
		title: 'translucent pattern, outline',
		build: (x, y) => ({
			sources: {
				patternBackdrop: collection([feature(box(x, y, 0.008))]),
				striped: collection([feature(box(x, y, 0.012))]),
			},
			layers: [
				{
					id: 'pattern-backdrop',
					type: 'fill',
					source: 'patternBackdrop',
					paint: { 'fill-color': '#ffcc00' },
				},
				{
					id: 'fill-pattern-translucent',
					type: 'fill',
					source: 'striped',
					paint: {
						'fill-pattern': 'base:pattern-striped',
						'fill-opacity': 0.6,
						'fill-outline-color': '#ff0000',
					},
				},
			],
		}),
	},
	{
		// Data-driven: a small pattern on the left; on the right, a missing image draws nothing.
		title: 'data-driven pattern, missing image',
		build: (x, y) => ({
			sources: {
				patterns: collection([
					feature(box(x - 0.007, y, 0.006), { pattern: 'base:pattern-hatched_thin' }),
					feature(box(x + 0.007, y, 0.006), { pattern: 'base:missing' }),
				]),
			},
			layers: [
				{
					id: 'fill-pattern-data-driven',
					type: 'fill',
					source: 'patterns',
					paint: { 'fill-pattern': ['get', 'pattern'] },
				},
			],
		}),
	},
];

export function featuresStyle(): StyleSpecification {
	return gridStyle(cells, {
		sprite: [{ id: 'base', url: 'https://tiles.versatiles.org/assets/sprites/base' }],
		state: {
			color: { default: '#8800cc' },
			which: { default: 'shown' },
			hidden: { default: true },
		},
	});
}
