/**
 * Images that are not in a sprite (the `images` option), which MapLibre GL JS gets with
 * `map.addImage`, one use per cell. They are made here, in code: an SDF disk, an RGBA arrow and
 * a pattern with differently colored quarters, so a pattern that is turned or flipped shows.
 *
 * | SDF icon, colored | SDF icon, halo   | SDF icon, pixelRatio 2 |
 * | RGBA icon         | fill-pattern     | line-pattern           |
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleImage } from '../../../packages/svg-renderer/src/index.js';
import { box, collection, feature, gridStyle, type Cell } from './grid.js';

/** An image of `width` × `height` pixels, each from `pixel(x, y)` as RGBA. */
function image(
	id: string,
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number, number],
	options: { pixelRatio?: number; sdf?: boolean } = {},
): StyleImage {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
	}
	return { id, width, height, data, ...options };
}

/**
 * A disk as a distance field: 192 (0.75) on its edge, as in MapLibre's SDF images, falling by 24
 * per pixel outward, so a halo has room.
 */
function disk(id: string, size: number, pixelRatio: number): StyleImage {
	const center = size / 2;
	const radius = size / 4;
	return image(
		id,
		size,
		size,
		(x, y) => {
			const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center) - radius;
			return [0, 0, 0, Math.max(0, Math.min(255, Math.round(192 - distance * 24)))];
		},
		{ pixelRatio, sdf: true },
	);
}

/** The images of the scene. */
export const images: StyleImage[] = [
	disk('disk', 48, 1),
	disk('disk@2', 96, 2),
	// an arrow pointing right, red at its tip, on a transparent background
	image('arrow', 40, 24, (x, y) => {
		const inside = Math.abs(y - 11.5) <= (40 - x) * 0.3 && x >= 4;
		return inside ? [x > 28 ? 255 : 40, 40, x > 28 ? 40 : 200, 255] : [0, 0, 0, 0];
	}),
	// quarters: red top left, green top right, blue bottom left, yellow bottom right
	image('quarters', 16, 16, (x, y) => {
		if (y < 8) return x < 8 ? [220, 30, 30, 255] : [30, 160, 30, 255];
		return x < 8 ? [30, 30, 220, 255] : [230, 200, 0, 255];
	}),
];

/** A cell with one icon at its center. */
function icon(
	title: string,
	id: string,
	layout: Record<string, unknown>,
	paint: Record<string, unknown> = {},
): Cell {
	return {
		title,
		build: (x, y) => ({
			sources: { [id]: collection([feature({ type: 'Point', coordinates: [x, y] })]) },
			layers: [
				{ id, type: 'symbol', source: id, layout: { 'icon-size': 2, ...layout }, paint } as never,
			],
		}),
	};
}

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	icon('SDF icon, colored', 'image-sdf', { 'icon-image': 'disk' }, { 'icon-color': '#cc2200' }),
	icon(
		'SDF icon, halo',
		'image-sdf-halo',
		{ 'icon-image': 'disk' },
		{ 'icon-color': '#ffffff', 'icon-halo-color': '#0044cc', 'icon-halo-width': 3 },
	),
	icon(
		'SDF icon, pixelRatio 2',
		'image-sdf-ratio',
		{ 'icon-image': 'disk@2' },
		{ 'icon-color': '#008844' },
	),
	icon('RGBA icon', 'image-rgba', { 'icon-image': 'arrow' }),
	{
		title: 'fill-pattern',
		build: (x, y) => ({
			sources: { 'image-fill': collection([feature(box(x, y, 0.012))]) },
			layers: [
				{
					id: 'image-fill',
					type: 'fill',
					source: 'image-fill',
					paint: { 'fill-pattern': 'quarters' },
				},
			],
		}),
	},
	{
		title: 'line-pattern',
		build: (x, y) => ({
			sources: {
				'image-line': collection([
					feature({
						type: 'LineString',
						coordinates: [
							[x - 0.014, y - 0.006],
							[x + 0.014, y + 0.006],
						],
					}),
				]),
			},
			layers: [
				{
					id: 'image-line',
					type: 'line',
					source: 'image-line',
					paint: { 'line-pattern': 'quarters', 'line-width': 16 },
				},
			],
		}),
	},
];

export function imagesStyle(): StyleSpecification {
	return gridStyle(cells);
}
