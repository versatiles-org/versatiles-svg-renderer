/**
 * Blurred label halos, one label per cell. MapLibre fades a halo with `text-halo-blur`: a
 * smoothstep (1.19 · blur) / 8 of the glyph's distance field to either side of the halo's
 * edge, within the glyph's box. The VersaTiles style blurs its halos by 1.
 *
 * | 12 px, halo 2, blur 1     | 14 px, translucent        | 24 px, halo 1, blur 1     |
 * | 24 px, halo 3, blur 1     | 24 px, halo 3, blur 3     | 40 px, halo 2, blur 2     |
 * | 40 px, halo 8, blur 4     | 24 px, halo 0.5, blur 1   | along a line, blur 1      |
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { gridStyle, type Cell } from './grid.js';
import { scriptCell } from './scripts.js';

function blurCell(options: {
	id: string;
	title: string;
	size: number;
	width: number;
	blur: number;
	color?: string;
	line?: boolean;
}): Cell {
	const { id, title, size, width, blur, color = '#ffcc00', line = false } = options;
	return scriptCell({
		id,
		title,
		text: 'Halo',
		line,
		layout: { 'text-size': size },
		paint: { 'text-halo-width': width, 'text-halo-blur': blur, 'text-halo-color': color },
	});
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	// As the VersaTiles style draws its labels.
	blurCell({ id: 'blur-12-2-1', title: '12 px, halo 2, blur 1', size: 12, width: 2, blur: 1 }),
	blurCell({
		id: 'blur-translucent',
		title: '14 px, halo 2, blur 1, translucent',
		size: 14,
		width: 2,
		blur: 1,
		color: 'rgba(0, 120, 255, 0.5)',
	}),
	blurCell({ id: 'blur-24-1-1', title: '24 px, halo 1, blur 1', size: 24, width: 1, blur: 1 }),
	blurCell({ id: 'blur-24-3-1', title: '24 px, halo 3, blur 1', size: 24, width: 3, blur: 1 }),
	blurCell({ id: 'blur-24-3-3', title: '24 px, halo 3, blur 3', size: 24, width: 3, blur: 3 }),
	blurCell({ id: 'blur-40-2-2', title: '40 px, halo 2, blur 2', size: 40, width: 2, blur: 2 }),
	blurCell({ id: 'blur-40-8-4', title: '40 px, halo 8, blur 4', size: 40, width: 8, blur: 4 }),
	// Halos up to 1 px MapLibre draws with each glyph, not all before the glyphs.
	blurCell({
		id: 'blur-24-half-1',
		title: '24 px, halo 0.5, blur 1',
		size: 24,
		width: 0.5,
		blur: 1,
	}),
	blurCell({
		id: 'blur-line',
		title: 'along a line, halo 2, blur 1',
		size: 16,
		width: 2,
		blur: 1,
		line: true,
	}),
];

export function haloBlurStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
	});
}
