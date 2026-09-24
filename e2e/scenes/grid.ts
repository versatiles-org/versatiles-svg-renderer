/**
 * Scenes that check single MapLibre features, one per cell of a 3 × 3 grid around 0°/0°:
 * a mismatch in a region's diff image points straight at the cell, and so at the feature.
 * At zoom 12, the view is about 0.137° wide and 0.103° high.
 */
import type {
	LayerSpecification,
	SourceSpecification,
	StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { Feature, Geometry } from 'geojson';

/** The centers of the grid's columns (longitudes) and rows (latitudes), in degrees. */
const COLUMNS = [-0.045, 0, 0.045];
const ROWS = [0.033, 0, -0.033];

/** One check: sources and layers drawn around the cell's center, and nowhere else. */
export interface Cell {
	/** What the cell checks, in a few words. */
	title: string;
	/** The cell's sources and layers; their ids must be unique within the scene. */
	build(
		x: number,
		y: number,
	): {
		sources?: Record<string, SourceSpecification>;
		layers: LayerSpecification[];
	};
}

/**
 * A scene: `cells` row by row, three per row, on a white background; `style` adds what the
 * scene's cells share, such as `sprite`, `glyphs` or `state`.
 */
export function gridStyle(
	cells: Cell[],
	style: Partial<Omit<StyleSpecification, 'sources' | 'layers'>> = {},
): StyleSpecification {
	if (cells.length > COLUMNS.length * ROWS.length) throw new Error('too many cells for the grid');
	const scene: StyleSpecification = {
		version: 8,
		...style,
		sources: {},
		layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }],
	};
	cells.forEach((cell, i) => {
		const { sources = {}, layers } = cell.build(COLUMNS[i % 3]!, ROWS[Math.floor(i / 3)]!);
		for (const [id, source] of Object.entries(sources)) {
			if (id in scene.sources) throw new Error(`source "${id}" is in two cells`);
			scene.sources[id] = source;
		}
		for (const layer of layers) {
			if (scene.layers.some(({ id }) => id === layer.id)) {
				throw new Error(`layer "${layer.id}" is in two cells`);
			}
			scene.layers.push(layer);
		}
	});
	return scene;
}

/** A GeoJSON source of `features`. */
export function collection(features: Feature[]): SourceSpecification {
	return { type: 'geojson', data: { type: 'FeatureCollection', features } };
}

export function feature(geometry: Geometry, properties: Record<string, unknown> = {}): Feature {
	return { type: 'Feature', properties, geometry };
}

/** A square around `lon`, `lat`, `size` degrees from its center to each side. */
export function box(lon: number, lat: number, size: number): Geometry {
	return {
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
	};
}
