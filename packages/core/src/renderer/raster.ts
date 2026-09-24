import type { RasterStyle, RasterTriangle } from '../types.js';

/**
 * How every backend draws raster tiles: their colour adjustments, the slight overlap of
 * tiles drawn as rectangles, and the geometry of tiles drawn as a mesh of triangles on the
 * globe. The SVG renderer turns each triangle into a `<use>` with a matrix transform, the
 * canvas renderer into a clipped `drawImage`. Keeping the math in one place keeps the two
 * backends from drifting apart on the seams between tiles.
 */

export type Triangle = RasterTriangle['source'];

/** Size of a raster tile image in user units, when drawn as a mesh of triangles on the globe. */
export const RASTER_TILE_UNITS = 256;

/** How far (pixels) a raster tile image reaches beyond the tile border in the seam underlay. */
export const RASTER_TILE_BLEED_PX = 1;

/** How far (pixels) each raster triangle is grown beyond its edges to overlap its neighbours. */
export const RASTER_TRIANGLE_OVERLAP_PX = 0.5;

/**
 * The affine transform [a, b, c, d, e, f] mapping the source triangle (in tile units 0..1,
 * scaled to RASTER_TILE_UNITS) exactly onto the target triangle, or undefined if either is
 * degenerate.
 */
export function affineFromTriangles(
	source: Triangle,
	target: Triangle,
): [number, number, number, number, number, number] | undefined {
	const k = RASTER_TILE_UNITS;
	const [[u0, v0], [u1, v1], [u2, v2]] = source.map(([u, v]) => [u * k, v * k]) as Triangle;
	const [[x0, y0], [x1, y1], [x2, y2]] = target;
	const du1 = u1 - u0;
	const dv1 = v1 - v0;
	const du2 = u2 - u0;
	const dv2 = v2 - v0;
	const det = du1 * dv2 - du2 * dv1;
	if (Math.abs(det) < 1e-12) return undefined;
	const dx1 = x1 - x0;
	const dx2 = x2 - x0;
	const dy1 = y1 - y0;
	const dy2 = y2 - y0;
	// Screen area below a hundredth of a pixel: nothing to draw.
	if (Math.abs(dx1 * dy2 - dx2 * dy1) < 0.02) return undefined;
	const a = (dx1 * dv2 - dx2 * dv1) / det;
	const c = (du1 * dx2 - du2 * dx1) / det;
	const b = (dy1 * dv2 - dy2 * dv1) / det;
	const d = (du1 * dy2 - du2 * dy1) / det;
	return [a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0];
}

export function isOnTileBorder(source: Triangle): boolean {
	return source.some(([u, v]) => u === 0 || u === 1 || v === 0 || v === 1);
}

/**
 * Moves the source corners of a triangle that lie on the tile border inwards, by the
 * equivalent of RASTER_TILE_BLEED_PX on screen, so that the image edge lies beyond the border.
 * (Used for the underlay that closes the seams between tiles, see `meshTriangles`.)
 */
export function bleedAtTileBorder(source: Triangle, target: Triangle): Triangle {
	const [[u0, v0], [u1, v1], [u2, v2]] = source;
	const [[x0, y0], [x1, y1], [x2, y2]] = target;
	const sourceArea = Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0));
	const targetArea = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
	if (sourceArea === 0 || targetArea === 0) return source;
	// Pixels per tile unit, and the bleed in tile units, kept within the triangle.
	const scale = Math.sqrt(targetArea / sourceArea);
	const size = Math.max(Math.abs(u1 - u0), Math.abs(u2 - u0), Math.abs(v1 - v0), Math.abs(v2 - v0));
	const bleed = Math.min(RASTER_TILE_BLEED_PX / scale, size / 4);
	const inset = (t: number): number => (t === 0 ? bleed : t === 1 ? 1 - bleed : t);
	return source.map(([u, v]) => [inset(u), inset(v)]) as Triangle;
}

/**
 * Moves every edge of a triangle outwards by `distance`, by scaling it around its incenter.
 * Growth is limited for very thin triangles, whose corners would otherwise shoot far out.
 */
export function growTriangle(triangle: Triangle, distance: number): Triangle {
	const [[x0, y0], [x1, y1], [x2, y2]] = triangle;
	const a = Math.hypot(x2 - x1, y2 - y1);
	const b = Math.hypot(x2 - x0, y2 - y0);
	const c = Math.hypot(x1 - x0, y1 - y0);
	const perimeter = a + b + c;
	const area = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
	if (perimeter === 0 || area === 0) return triangle;
	const inradius = (2 * area) / perimeter;
	const cx = (a * x0 + b * x1 + c * x2) / perimeter;
	const cy = (a * y0 + b * y1 + c * y2) / perimeter;
	const scale = 1 + distance / Math.max(inradius, 2 * distance);
	return triangle.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale]) as Triangle;
}

/** A raster layer's colour adjustments as CSS filter functions, or `''` without any. */
export function rasterFilter(style: RasterStyle): string {
	const filters: string[] = [];
	if (style.hueRotate !== 0) filters.push(`hue-rotate(${String(style.hueRotate)}deg)`);
	if (style.saturation !== 0) filters.push(`saturate(${String(style.saturation + 1)})`);
	if (style.contrast !== 0) filters.push(`contrast(${String(style.contrast + 1)})`);
	if (style.brightnessMin !== 0 || style.brightnessMax !== 1) {
		const brightness = (style.brightnessMin + style.brightnessMax) / 2;
		filters.push(`brightness(${String(brightness)})`);
	}
	return filters.join(' ');
}

/**
 * How far a tile drawn as a rectangle reaches past each of its sides, in pixels: a slight
 * overlap that keeps sub-pixel gaps from showing between neighbouring tiles.
 */
export function tileOverlap(tile: { width: number; height: number }): number {
	return Math.min(tile.width, tile.height) / 10000;
}

/**
 * The triangles of tiles drawn as meshes (globe projection), in the order to draw them.
 * Each shows its tile's image through the affine transform mapping its three source corners
 * exactly onto its three screen corners (see {@link affineFromTriangles}), clipped to the
 * triangle on screen.
 *
 * Seams: within a tile, each clip triangle is grown by RASTER_TRIANGLE_OVERLAP_PX; the same
 * transform continues there, so the overlap shows (almost) the same pixels as the neighbour.
 * At tile borders that is not enough, as both images end on the same line and their anti-
 * aliased edges let a hairline of the background shine through. So first, as an underlay,
 * the triangles along the tile borders come with their image reaching beyond the border
 * (see {@link bleedAtTileBorder}), except for a standalone tile; then all triangles exactly
 * on top of it. The slightly shifted underlay only shows through the seam.
 */
export function meshTriangles<T>(
	meshes: { image: T; triangles: RasterTriangle[]; standalone: boolean }[],
): { image: T; source: Triangle; target: Triangle }[] {
	const result: { image: T; source: Triangle; target: Triangle }[] = [];
	for (const { image, triangles, standalone } of meshes) {
		if (standalone) continue;
		for (const { source, target } of triangles) {
			if (!isOnTileBorder(source)) continue;
			result.push({ image, source: bleedAtTileBorder(source, target), target });
		}
	}
	for (const { image, triangles } of meshes) {
		for (const { source, target } of triangles) result.push({ image, source, target });
	}
	return result;
}
