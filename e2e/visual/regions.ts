/**
 * The regions the e2e screenshots compare with MapLibre GL JS: which style, seen how.
 */

/** Where a region looks, as MapLibre's camera options. */
export interface View {
	lon: number;
	lat: number;
	zoom: number;
	/** The compass direction that is up, in degrees. */
	bearing?: number;
	/** Space around the map's center, in pixels. */
	padding?: { top?: number; right?: number; bottom?: number; left?: number };
}

/**
 * The styles regions draw (see `getStyle`):
 * - `vector`, `satellite`: the VersaTiles styles;
 * - `geojson`, `features`, `symbols`, `sources`, `patterns`, `anchors`: hand-made scenes, in
 *   `scenes/`.
 */
export type StyleName =
	'vector' | 'satellite' | 'geojson' | 'features' | 'symbols' | 'sources' | 'patterns' | 'anchors';

export interface Region {
	/** Unique; also the region's key in `diff-baseline.json`. */
	id: string;
	style: StyleName;
	view: View;
	/** The style's projection; Mercator unless `globe`. */
	projection?: 'globe';
	/**
	 * Draw labels and icons. Off for most regions, because MapLibre's glyphs and the
	 * renderers' differ just enough to dominate a region's diff.
	 */
	labels?: boolean;
	/**
	 * Add line layers on polygons (building outlines, translucent water outlines): the
	 * VersaTiles styles have none, and polygons clipped to their tile must not show their
	 * clipped edges.
	 */
	outlines?: boolean;
}

const berlin: View = { lon: 13.357, lat: 52.515, zoom: 14.2 };
const berlinSatellite: View = { lon: 13.376, lat: 52.518, zoom: 15 };
const europe: View = { lon: 12, lat: 50, zoom: 3.5 };
const world: View = { lon: 10, lat: 20, zoom: 2 };
/** The hand-made scenes are laid out around 0°/0° (see `scenes/grid.ts`). */
const scene: View = { lon: 0, lat: 0, zoom: 12 };

export const regions: Region[] = [
	// Cities in the VersaTiles style.
	{ id: 'berlin-vector', style: 'vector', view: berlin },
	{ id: 'paris-vector', style: 'vector', view: { lon: 2.295, lat: 48.858, zoom: 14.9 } },
	{ id: 'warsaw-vector', style: 'vector', view: { lon: 21.013, lat: 52.249, zoom: 14.9 } },
	{ id: 'tokyo-vector', style: 'vector', view: { lon: 139.692, lat: 35.69, zoom: 10 } },
	{ id: 'roma-vector', style: 'vector', view: { lon: 12.489, lat: 41.89, zoom: 14.9 } },
	{ id: 'sao-paulo-vector', style: 'vector', view: { lon: -46.635, lat: -23.548, zoom: 14 } },

	{ id: 'berlin-labels-vector', style: 'vector', view: berlin, labels: true },
	{
		id: 'berlin-outlines-vector',
		style: 'vector',
		view: { lon: 13.399, lat: 52.519, zoom: 15.5 },
		outlines: true,
	},

	// Rotated maps: the map, satellite tiles, labels (upright at points, along their lines),
	// patterns and the globe all turn with the bearing.
	{ id: 'berlin-rotated-vector', style: 'vector', view: { ...berlin, bearing: 30 } },
	{
		id: 'berlin-labels-rotated-vector',
		style: 'vector',
		view: { ...berlin, bearing: -60 },
		labels: true,
	},
	{
		id: 'berlin-rotated-satellite',
		style: 'satellite',
		view: { ...berlinSatellite, bearing: -45 },
	},
	{ id: 'parity-rotated-features', style: 'features', view: { ...scene, bearing: 30 } },
	{ id: 'parity-rotated-sources', style: 'sources', view: { ...scene, bearing: 30 } },
	{ id: 'parity-rotated-patterns', style: 'patterns', view: { ...scene, bearing: 30 } },

	// Padding moves the map's center, also on a rotated map and on the globe.
	{
		id: 'berlin-padded-vector',
		style: 'vector',
		view: { ...berlin, padding: { left: 300, top: 150 } },
	},
	{
		id: 'berlin-padded-satellite',
		style: 'satellite',
		view: { ...berlinSatellite, bearing: 30, padding: { right: 200, bottom: 100 } },
	},
	{
		id: 'europe-padded-vector-globe',
		style: 'vector',
		view: { ...europe, padding: { left: 300 } },
		projection: 'globe',
	},
	{
		id: 'europe-rotated-vector-globe',
		style: 'vector',
		view: { ...europe, bearing: 20 },
		projection: 'globe',
	},

	{ id: 'berlin-satellite', style: 'satellite', view: berlinSatellite },

	// Hand-made scenes, each checking single features.
	{ id: 'berlin-geojson', style: 'geojson', view: { lon: 13.388, lat: 52.514, zoom: 14 } },
	{ id: 'parity-features', style: 'features', view: scene },
	{ id: 'parity-symbols', style: 'symbols', view: scene, labels: true },
	{ id: 'parity-anchors', style: 'anchors', view: scene, labels: true },
	{ id: 'parity-sources', style: 'sources', view: scene },
	{ id: 'parity-patterns', style: 'patterns', view: scene },
	// Patterns are scaled with the map from the zoom level's integer part.
	{ id: 'parity-patterns-z11.5', style: 'patterns', view: { ...scene, zoom: 11.5 } },

	// Globe projection: a full globe at low zoom, a high latitude (the globe is scaled by
	// 1/cos(lat)) and the globe->mercator transition between zoom 11 and 12.
	// High zoom levels magnify any imprecision of the globe (radius ~10^5 px); the reference
	// runs with a precise sin/cos in MapLibre's globe shader (see `shared/maplibre-page.ts`).
	{ id: 'world-vector-globe', style: 'vector', view: world, projection: 'globe' },
	{ id: 'europe-vector-globe', style: 'vector', view: europe, projection: 'globe' },
	{
		id: 'scandinavia-vector-globe',
		style: 'vector',
		view: { lon: 20, lat: 68, zoom: 5 },
		projection: 'globe',
	},
	{
		id: 'japan-vector-globe',
		style: 'vector',
		view: { lon: 138.5, lat: 36, zoom: 7 },
		projection: 'globe',
	},
	{
		id: 'tokyo-z11.5-vector-globe',
		style: 'vector',
		view: { lon: 139.692, lat: 35.69, zoom: 11.5 },
		projection: 'globe',
	},
	{ id: 'world-satellite-globe', style: 'satellite', view: world, projection: 'globe' },
	{ id: 'europe-satellite-globe', style: 'satellite', view: europe, projection: 'globe' },
];
