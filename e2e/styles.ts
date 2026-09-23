import { resolve } from 'node:path';
import { inlineSources, osm, satellite } from '@versatiles/style';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Feature } from 'geojson';
import { LineLayerSpecification } from 'maplibre-gl';

export interface Region {
	name: string;
	lon: number;
	lat: number;
	zoom: number;
	/**
	 * `features`: a hand-made style that checks single MapLibre features, one per cell of a
	 * grid (see {@link featuresStyle}).
	 */
	type: 'vector' | 'satellite' | 'geojson' | 'features';
	/** Style projection; defaults to 'mercator'. */
	projection?: 'mercator' | 'globe';
	/**
	 * Draw labels and icons. Off everywhere else, because text rendering differs between
	 * MapLibre's SDF glyphs and the renderers' system fonts and would otherwise dominate
	 * every region's diff. One region turns it on so the symbol path stays measured.
	 */
	labels?: boolean;
}

export const regions: Region[] = [
	{ name: 'berlin', lon: 13.357, lat: 52.515, zoom: 14.2, type: 'vector' },
	{ name: 'paris', lon: 2.295, lat: 48.858, zoom: 14.9, type: 'vector' },
	{ name: 'warsaw', lon: 21.013, lat: 52.249, zoom: 14.9, type: 'vector' },
	{ name: 'tokyo', lon: 139.692, lat: 35.69, zoom: 10, type: 'vector' },
	{ name: 'roma', lon: 12.489, lat: 41.89, zoom: 14.9, type: 'vector' },
	{ name: 'sao-paulo', lon: -46.635, lat: -23.548, zoom: 14, type: 'vector' },

	{ name: 'berlin-labels', lon: 13.357, lat: 52.515, zoom: 14.2, type: 'vector', labels: true },

	{ name: 'berlin', lon: 13.376, lat: 52.518, zoom: 15, type: 'satellite' },

	{ name: 'berlin', lon: 13.388, lat: 52.514, zoom: 14, type: 'geojson' },

	{ name: 'parity', lon: 0, lat: 0, zoom: 12, type: 'features' },

	// Globe projection: a full globe at low zoom, a high latitude (the globe is scaled by
	// 1/cos(lat)) and the globe->mercator transition between zoom 11 and 12.
	// High zoom levels magnify any imprecision of the globe (radius ~10^5 px); the reference
	// runs with a precise sin/cos in MapLibre's globe shader (see e2e/maplibre-page.ts).
	{ name: 'world', lon: 10, lat: 20, zoom: 2, type: 'vector', projection: 'globe' },
	{ name: 'europe', lon: 12, lat: 50, zoom: 3.5, type: 'vector', projection: 'globe' },
	{ name: 'scandinavia', lon: 20, lat: 68, zoom: 5, type: 'vector', projection: 'globe' },
	{ name: 'japan', lon: 138.5, lat: 36, zoom: 7, type: 'vector', projection: 'globe' },
	{
		name: 'tokyo-z11.5',
		lon: 139.692,
		lat: 35.69,
		zoom: 11.5,
		type: 'vector',
		projection: 'globe',
	},
	{ name: 'world', lon: 10, lat: 20, zoom: 2, type: 'satellite', projection: 'globe' },
	{ name: 'europe', lon: 12, lat: 50, zoom: 3.5, type: 'satellite', projection: 'globe' },
];

/**
 * The fonts the styles name in `text-font`, mapped to real files.
 *
 * A style only names its fonts; MapLibre then fetches pre-rendered SDF glyphs from its
 * glyph server, which a renderer drawing real text cannot use. Without these, both
 * renderers fall back to whatever the machine has installed and every label is measured
 * against the wrong typeface.
 */
const fontDir = resolve(import.meta.dirname, '../node_modules/@fontsource/noto-sans/files');
export const fonts: Record<string, string> = {
	noto_sans_regular: resolve(fontDir, 'noto-sans-latin-400-normal.woff2'),
	noto_sans_bold: resolve(fontDir, 'noto-sans-latin-700-normal.woff2'),
};

export function regionId(region: Region): string {
	const id = `${region.name}-${region.type}`;
	return region.projection === 'globe' ? `${id}-globe` : id;
}

const styleCache = new Map<string, StyleSpecification>();
export async function getStyle(region: Region): Promise<StyleSpecification> {
	const { type } = region;
	const projection = region.projection ?? 'mercator';
	const labels = region.labels ?? false;
	const cacheKey = `${type}-${projection}-${String(labels)}`;
	let style = styleCache.get(cacheKey);
	if (!style) {
		switch (type) {
			case 'vector':
				style = await inlineSources(
					osm({
						theme: 'colorful',
						projection,
						layers: { labels, icons: labels },
					}),
				);
				break;
			case 'satellite':
				style = await inlineSources(satellite({ projection, osmOverlay: false }));
				break;
			case 'features':
				style = featuresStyle();
				break;
			case 'geojson':
				style = {
					version: 8,
					sources: {},
					layers: [
						{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
					],
				};
				style.sources['geojson-overlay'] = {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: [
							{
								type: 'Polygon',
								coordinates: [
									[
										[13.38, 52.52],
										[13.39, 52.52],
										[13.39, 52.514],
										[13.38, 52.514],
										[13.38, 52.52],
									],
									[
										[13.383, 52.518],
										[13.387, 52.518],
										[13.387, 52.516],
										[13.383, 52.516],
										[13.383, 52.518],
									],
								],
							},
							{
								type: 'LineString',
								coordinates: [
									[13.391, 52.515],
									[13.392, 52.519],
									[13.393, 52.516],
									[13.394, 52.519],
									[13.395, 52.515],
								],
							},
							...(
								[
									[13.399, 52.519],
									[13.398, 52.517],
									[13.397, 52.515],
								] as [number, number][]
							).map((coordinates) => ({
								type: 'Point',
								coordinates,
							})),
						].map(
							(geometry) =>
								({
									type: 'Feature',
									properties: {},
									geometry,
								}) as Feature,
						),
					},
				};
				// Isolated west->east line for validating line-offset direction and line-blur
				// against MapLibre (kept separate from the polygon so ring rewinding does not
				// affect the offset side).
				style.sources['geojson-lines'] = {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: {
							type: 'LineString',
							coordinates: [
								[13.382, 52.512],
								[13.392, 52.512],
							],
						},
					},
				};
				// Six overlapping rectangles cascading diagonally, each a different rainbow
				// color via data-driven `fill-color`. Checks data-driven paint and that
				// overlapping fills paint in source order (last on top) like MapLibre.
				// (The run-length grouping itself is unit-tested in svg.test.ts.)
				style.sources['geojson-stack'] = {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: (
							['#ff0000', '#ff8800', '#ffdd00', '#00bb00', '#0077ff', '#8800dd'] as string[]
						).map((color, i) => {
							const lon = 13.379 + i * 0.0012;
							const lat = 52.51 - i * 0.0002;
							return {
								type: 'Feature',
								properties: { color },
								geometry: {
									type: 'Polygon',
									coordinates: [
										[
											[lon, lat],
											[lon + 0.004, lat],
											[lon + 0.004, lat - 0.0025],
											[lon, lat - 0.0025],
											[lon, lat],
										],
									],
								},
							};
						}),
					},
				};
				style.layers.push(
					{
						id: 'geojson-fill',
						type: 'fill',
						source: 'geojson-overlay',
						paint: {
							'fill-color': '#00aaaa',
							'fill-opacity': 0.3,
						},
					},
					{
						id: 'geojson-stack',
						type: 'fill',
						source: 'geojson-stack',
						paint: {
							'fill-color': ['get', 'color'],
							// Explicit choropleth-style border. MapLibre draws each rectangle's
							// outline over ALL fills, so a lower rectangle's white edge shows on
							// top of a later overlapping fill — the parity case for fill-outline-color.
							'fill-outline-color': '#ffffff',
						},
					},
					{
						id: 'geojson-line',
						type: 'line',
						source: 'geojson-overlay',
						paint: {
							'line-color': '#0000ff',
							'line-width': 4,
						},
					},
					{
						id: 'geojson-line-offset',
						type: 'line',
						source: 'geojson-lines',
						paint: {
							'line-color': '#ff8800',
							'line-width': 2,
							'line-offset': -20,
						},
					},
					...([2, 5, 10, 20].map((blur, index) => ({
						id: `geojson-line-blur-${blur}`,
						type: 'line',
						source: 'geojson-lines',
						paint: {
							'line-color': '#0000cc',
							'line-width': 10,
							'line-offset': index * 20,
							'line-blur': blur,
						},
					})) as LineLayerSpecification[]),
					{
						id: 'geojson-circle',
						type: 'circle',
						source: 'geojson-overlay',
						paint: {
							'circle-radius': 8,
							'circle-color': '#cc0000',
							'circle-stroke-width': 2,
							'circle-stroke-color': '#00cc00',
						},
					},
				);
				break;
		}
		styleCache.set(cacheKey, style);
	}
	return style;
}

/**
 * A style with one MapLibre feature per cell of a 3 × 3 grid, around 0°/0° at zoom 12 (the
 * view is about 0.137° wide and 0.103° high). Each cell isolates one feature, so a
 * mismatch in the diff image points straight at it:
 *
 * | fill-sort-key           | line-sort-key               | circle-sort-key              |
 * | circle(-stroke)-opacity | line-gap-width              | global-state                 |
 * | fill-pattern            | translucent pattern, outline | data-driven, missing image |
 */
function featuresStyle(): StyleSpecification {
	const columns = [-0.045, 0, 0.045];
	const rows = [0.033, 0, -0.033];
	const colors = ['#e41a1c', '#4daf4a', '#377eb8'];
	type Geometry = Feature['geometry'];
	const feature = (geometry: Geometry, properties: Record<string, unknown> = {}): Feature => ({
		type: 'Feature',
		properties,
		geometry,
	});
	const box = (lon: number, lat: number, size: number): Geometry => ({
		type: 'Polygon',
		coordinates: [
			[
				[lon - size, lat + size],
				[lon + size, lat + size],
				[lon + size, lat - size],
				[lon - size, lat - size],
				[lon - size, lat + size],
			],
		],
	});
	const collection = (features: Feature[]) => ({
		type: 'geojson' as const,
		data: { type: 'FeatureCollection' as const, features },
	});

	// Row 1: three overlapping shapes each, in source order red, green, blue, with sort keys
	// 3, 2, 1: MapLibre draws blue first and red on top.
	const [x1, x2, x3] = columns as [number, number, number];
	const [y1, y2, y3] = rows as [number, number, number];
	const sortKeyed = (make: (i: number) => Geometry) =>
		collection(colors.map((color, i) => feature(make(i), { color, key: 3 - i })));

	return {
		version: 8,
		sprite: [{ id: 'base', url: 'https://tiles.versatiles.org/assets/sprites/base' }],
		state: {
			color: { default: '#8800cc' },
			which: { default: 'shown' },
			hidden: { default: true },
		},
		sources: {
			fills: sortKeyed((i) => box(x1 - 0.006 + i * 0.006, y1 + 0.006 - i * 0.006, 0.008)),
			lines: sortKeyed((i) => ({
				type: 'LineString',
				coordinates: [
					[x2 - 0.015, y1 + 0.012 - i * 0.012],
					[x2 + 0.015, y1 - 0.012 + i * 0.012],
				],
			})),
			circles: sortKeyed((i) => ({
				type: 'Point',
				coordinates: [x3 - 0.004 + i * 0.004, y1 + 0.003 - i * 0.003],
			})),
			backdrop: collection([feature(box(x1, y2, 0.016))]),
			opacities: collection(
				[
					{ opacity: 0.5, strokeOpacity: 1 },
					{ opacity: 1, strokeOpacity: 0.4 },
					{ opacity: 0, strokeOpacity: 0.7 },
				].map((props, i) =>
					feature({ type: 'Point', coordinates: [x1 - 0.01 + i * 0.01, y2] }, props),
				),
			),
			gap: collection([
				feature({
					type: 'LineString',
					coordinates: [
						[x2 - 0.016, y2 - 0.008],
						[x2 - 0.006, y2 + 0.01],
						[x2 + 0.004, y2 - 0.01],
						[x2 + 0.016, y2 + 0.006],
					],
				}),
			]),
			patterns: collection([
				feature(box(x1, y3, 0.012), { pattern: 'base:pattern-hatched' }),
				feature(box(x2, y3, 0.012), { pattern: 'base:pattern-striped' }),
				feature(box(x3 - 0.007, y3, 0.006), { pattern: 'base:pattern-hatched_thin' }),
				feature(box(x3 + 0.007, y3, 0.006), { pattern: 'base:missing' }),
			]),
			patternBackdrop: collection([feature(box(x2, y3, 0.008))]),
			state: collection([
				feature(box(x3 - 0.009, y2 + 0.006, 0.005), { which: 'shown' }),
				feature(box(x3 + 0.009, y2 + 0.006, 0.005), { which: 'filtered' }),
				feature(box(x3, y2 - 0.01, 0.005), { which: 'hidden' }),
			]),
		},
		layers: [
			{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
			{
				id: 'fill-sort-key',
				type: 'fill',
				source: 'fills',
				layout: { 'fill-sort-key': ['get', 'key'] },
				paint: { 'fill-color': ['get', 'color'] },
			},
			{
				id: 'line-sort-key',
				type: 'line',
				source: 'lines',
				layout: { 'line-sort-key': ['get', 'key'], 'line-cap': 'butt' },
				paint: { 'line-color': ['get', 'color'], 'line-width': 14 },
			},
			{
				id: 'circle-sort-key',
				type: 'circle',
				source: 'circles',
				layout: { 'circle-sort-key': ['get', 'key'] },
				paint: { 'circle-color': ['get', 'color'], 'circle-radius': 30 },
			},
			{
				id: 'backdrop',
				type: 'fill',
				source: 'backdrop',
				paint: { 'fill-color': '#333333' },
			},
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
				id: 'line-gap-width',
				type: 'line',
				source: 'gap',
				layout: { 'line-cap': 'butt', 'line-join': 'round' },
				paint: { 'line-color': '#0055aa', 'line-width': 4, 'line-gap-width': 12 },
			},
			{
				id: 'pattern-backdrop',
				type: 'fill',
				source: 'patternBackdrop',
				paint: { 'fill-color': '#ffcc00' },
			},
			{
				// Opaque patterns; the missing image draws nothing.
				id: 'fill-pattern',
				type: 'fill',
				source: 'patterns',
				filter: ['!=', ['get', 'pattern'], 'base:pattern-striped'],
				paint: { 'fill-pattern': ['get', 'pattern'] },
			},
			{
				id: 'fill-pattern-translucent',
				type: 'fill',
				source: 'patterns',
				filter: ['==', ['get', 'pattern'], 'base:pattern-striped'],
				paint: {
					'fill-pattern': 'base:pattern-striped',
					'fill-opacity': 0.6,
					'fill-outline-color': '#ff0000',
				},
			},
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
				// Outlines only the square the global state selects.
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
	};
}
