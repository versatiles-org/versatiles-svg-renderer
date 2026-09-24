/**
 * The cells of a grid scene on a region's image (see `scenes/grid.ts`), to measure each
 * cell's diff on its own: a change then points straight at the feature its cell checks.
 */
import type { Region } from './regions.js';
import { cellCenter } from './scenes/grid.js';
import { HEIGHT, SCALE, WIDTH } from './output.js';

/**
 * For each pixel of the region's image (`WIDTH × SCALE` by `HEIGHT × SCALE`, row by row),
 * the index of the cell it shows: the cell whose center is nearest, in Mercator.
 */
export function cellMap(region: Region, cellCount: number): Uint8Array {
	const { lon, lat, zoom, bearing = 0, padding = {} } = region.view;
	const worldSize = 512 * 2 ** zoom;
	const mercatorX = (lng: number): number => ((lng + 180) / 360) * worldSize;
	const mercatorY = (lt: number): number =>
		((1 - Math.log(Math.tan(Math.PI / 4 + (lt * Math.PI) / 360)) / Math.PI) / 2) * worldSize;
	const centers = Array.from({ length: cellCount }, (_, i) => {
		const [x, y] = cellCenter(i);
		return [mercatorX(x), mercatorY(y)] as const;
	});

	// The map's center on the image, and the turn from the image to the map.
	const centerX = WIDTH / 2 + ((padding.left ?? 0) - (padding.right ?? 0)) / 2;
	const centerY = HEIGHT / 2 + ((padding.top ?? 0) - (padding.bottom ?? 0)) / 2;
	const angle = (bearing * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const originX = mercatorX(lon);
	const originY = mercatorY(lat);

	const width = WIDTH * SCALE;
	const height = HEIGHT * SCALE;
	const map = new Uint8Array(width * height);
	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			const dx = (px + 0.5) / SCALE - centerX;
			const dy = (py + 0.5) / SCALE - centerY;
			// With a bearing, the map is turned counter-clockwise on the image.
			const x = originX + dx * cos - dy * sin;
			const y = originY + dx * sin + dy * cos;
			let nearest = 0;
			let best = Infinity;
			centers.forEach(([cx, cy], i) => {
				const d = (x - cx) ** 2 + (y - cy) ** 2;
				if (d < best) {
					best = d;
					nearest = i;
				}
			});
			map[py * width + px] = nearest;
		}
	}
	return map;
}

/**
 * The share of each cell's pixels that differ, in percent, from a pixelmatch diff image:
 * it paints each differing pixel pure red, and the others grey or yellow.
 */
export function cellShares(diff: Uint8Array, map: Uint8Array, cellCount: number): number[] {
	const pixels = new Array<number>(cellCount).fill(0);
	const differing = new Array<number>(cellCount).fill(0);
	for (let i = 0; i < map.length; i++) {
		const cell = map[i]!;
		pixels[cell]!++;
		if (diff[i * 4] === 255 && diff[i * 4 + 1] === 0 && diff[i * 4 + 2] === 0) differing[cell]!++;
	}
	return pixels.map((count, cell) => (count > 0 ? (differing[cell]! / count) * 100 : 0));
}
