/**
 * Label halos of different widths and text sizes, one label per cell. MapLibre draws a halo
 * `text-halo-width` pixels beyond the outline of each letter, but no further than the
 * distance field of its glyphs reaches: 3 of 24 pixels per em.
 *
 * | 12 px, halo 1             | 12 px, halo 3 (capped)    | 24 px, halo 1             |
 * | 24 px, halo 3             | 24 px, halo 6 (capped)    | 40 px, halo 2             |
 * | 40 px, halo 8 (capped)    | translucent halo          | Thai, 24 px, halo 3       |
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { gridStyle, type Cell } from './grid.js';
import { scriptCell } from './scripts.js';

function haloCell(options: {
	id: string;
	title: string;
	size: number;
	width: number;
	text?: string;
	color?: string;
}): Cell {
	const { id, title, size, width, text = 'Halo', color = '#ffcc00' } = options;
	return scriptCell({
		id,
		title,
		text,
		layout: { 'text-size': size },
		paint: { 'text-halo-width': width, 'text-halo-color': color },
	});
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	haloCell({ id: 'halo-12-1', title: '12 px, halo 1', size: 12, width: 1 }),
	haloCell({ id: 'halo-12-3', title: '12 px, halo 3 (capped)', size: 12, width: 3 }),
	haloCell({ id: 'halo-24-1', title: '24 px, halo 1', size: 24, width: 1 }),
	haloCell({ id: 'halo-24-3', title: '24 px, halo 3', size: 24, width: 3 }),
	haloCell({ id: 'halo-24-6', title: '24 px, halo 6 (capped)', size: 24, width: 6 }),
	haloCell({ id: 'halo-40-2', title: '40 px, halo 2', size: 40, width: 2 }),
	haloCell({ id: 'halo-40-8', title: '40 px, halo 8 (capped)', size: 40, width: 8 }),
	haloCell({
		id: 'halo-translucent',
		title: 'translucent halo',
		size: 24,
		width: 3,
		color: 'rgba(0, 120, 255, 0.5)',
	}),
	// "Krung Thep": MapLibre draws it with the browser's fonts.
	haloCell({ id: 'halo-thai', title: 'Thai, 24 px, halo 3', size: 24, width: 3, text: 'กรุงเทพ' }),
];

export function halosStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
	});
}
