import type { RenderJob, RasterTile } from '../renderer/svg.js';
import { Point2D } from '../geometry.js';
import { Projection } from '../projection.js';
import { tileDataUri, type TileLoader } from './tiles.js';

type Corners = [[number, number], [number, number], [number, number], [number, number]];

/**
 * How far MapLibre GL JS lets the projective warp of a quad foreshorten the image before it
 * starts blending it towards the bilinear one, and where it is bilinear only
 * (`PROJECTIVE_FORESHORTENING`, `BILINEAR_FORESHORTENING` in `image_source.ts`).
 */
const PROJECTIVE_FORESHORTENING = 4;
const BILINEAR_FORESHORTENING = 512;

/** Mesh cells per side for an image whose corners are not a parallelogram (MapLibre: 16). */
const WARPED_CELLS = 16;

/**
 * The image of an `image` source, placed on the map by its four `coordinates` (top left,
 * top right, bottom right, bottom left), as a raster tile. A lon/lat rectangle on a flat
 * north-up map is drawn as a plain rectangle; anything else as a mesh of triangles, warped
 * as MapLibre GL JS warps it. An image that cannot be loaded draws nothing.
 */
export async function getImageSourceTiles(
	job: RenderJob,
	sourceName: string,
	loadTile: TileLoader,
): Promise<RasterTile[]> {
	const source = job.style.sources[sourceName] as { url?: unknown; coordinates?: unknown };
	const corners = parseCorners(source.coordinates);
	if (typeof source.url !== 'string' || !corners) {
		throw Error(
			`Invalid image source "${sourceName}": expected a "url" and four "coordinates" [lng, lat]`,
		);
	}

	// An image is loaded like a tile whose URL has no placeholders.
	const image = await loadTile(source.url, 0, 0, 0);
	if (!image) return [];
	const dataUri = tileDataUri(image);

	const { width, height } = job.renderer;
	const projection =
		job.projection ??
		new Projection({ width, height, center: job.view.center, zoom: job.view.zoom });

	const at = imageWarp(corners);

	if (!projection.isGlobe) {
		const [tl, tr, br, bl] = corners.map(([mx, my]) => projection.project(mx, my));
		const x = tl!.x;
		const y = tl!.y;
		const rectWidth = br!.x - x;
		const rectHeight = br!.y - y;
		const epsilon = 1e-9 * Math.max(1, Math.abs(rectWidth), Math.abs(rectHeight));
		const isRectangle =
			Math.abs(tr!.y - y) < epsilon &&
			Math.abs(bl!.x - x) < epsilon &&
			Math.abs(tr!.x - br!.x) < epsilon &&
			Math.abs(bl!.y - br!.y) < epsilon;
		if (isRectangle && rectWidth > 0 && rectHeight > 0) {
			return [{ x, y, width: rectWidth, height: rectHeight, dataUri }];
		}
	}

	const xs = corners.map(([mx]) => mx);
	const ys = corners.map(([, my]) => my);
	const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
	const minCells = isParallelogram(corners) ? 1 : WARPED_CELLS;
	const triangles = projection.imageTriangles(at, size, minCells);
	if (triangles.length === 0) return [];
	return [{ x: 0, y: 0, width: 1, height: 1, dataUri, triangles, standalone: true }];
}

/** The four corners in mercator world coordinates, or `undefined` if they are not four [lng, lat]. */
function parseCorners(coordinates: unknown): Corners | undefined {
	if (!Array.isArray(coordinates) || coordinates.length !== 4) return undefined;
	const corners: [number, number][] = [];
	for (const coordinate of coordinates) {
		if (!Array.isArray(coordinate) || coordinate.length < 2) return undefined;
		const [lng, lat] = coordinate as unknown[];
		if (typeof lng !== 'number' || typeof lat !== 'number') return undefined;
		if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
		const point = new Point2D(lng, lat).getProject2Pixel();
		corners.push([point.x, point.y]);
	}
	return corners as Corners;
}

function isParallelogram([tl, tr, br, bl]: Corners): boolean {
	const size = Math.max(Math.abs(br[0] - tl[0]), Math.abs(br[1] - tl[1]), Math.abs(tr[0] - bl[0]));
	const epsilon = 1e-9 * size;
	return (
		Math.abs(tl[0] + br[0] - tr[0] - bl[0]) <= epsilon &&
		Math.abs(tl[1] + br[1] - tr[1] - bl[1]) <= epsilon
	);
}

/**
 * Where a position in the image (0..1 each way) lies on the map, in mercator world
 * coordinates, as MapLibre GL JS warps an image onto its corners (`calculateImageWarp` in
 * `image_source.ts` and the raster vertex shader): the projective mapping of the unit square
 * onto the quad, blended towards the bilinear one the more it foreshortens the image. A
 * parallelogram is mapped affinely, and a quad that is no perspective view of a rectangle
 * (concave, crossed) bilinearly.
 */
export function imageWarp(corners: Corners): (u: number, v: number) => [number, number] {
	const [tl, tr, br, bl] = corners;
	const bilinear = (u: number, v: number): [number, number] => {
		const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
		const bottom = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
		return [top[0]! + (bottom[0]! - top[0]!) * v, top[1]! + (bottom[1]! - top[1]!) * v];
	};
	if (isParallelogram(corners)) return bilinear;

	const sumX = tl[0] - tr[0] + br[0] - bl[0];
	const sumY = tl[1] - tr[1] + br[1] - bl[1];
	const rightX = tr[0] - br[0];
	const rightY = tr[1] - br[1];
	const downX = bl[0] - br[0];
	const downY = bl[1] - br[1];
	const determinant = rightX * downY - downX * rightY;
	const perspectiveX = (sumX * downY - downX * sumY) / determinant;
	const perspectiveY = (rightX * sumY - sumX * rightY) / determinant;

	// The homogeneous denominator at the corners, one at the top left: its spread is how much
	// the warp foreshortens the image, and it is finite and positive over the whole quad only
	// while the quad is a perspective view of the image.
	const denominators = [1, 1 + perspectiveX, 1 + perspectiveX + perspectiveY, 1 + perspectiveY];
	const foreshortening = Math.max(...denominators) / Math.min(...denominators);
	const blend = Math.max(
		0,
		(1 - PROJECTIVE_FORESHORTENING / foreshortening) /
			(1 - PROJECTIVE_FORESHORTENING / BILINEAR_FORESHORTENING),
	);
	if (!(foreshortening >= 1 && foreshortening <= BILINEAR_FORESHORTENING) || blend >= 1) {
		return bilinear;
	}

	const acrossTop = [tr[0] - tl[0] + perspectiveX * tr[0], tr[1] - tl[1] + perspectiveX * tr[1]];
	const downLeft = [bl[0] - tl[0] + perspectiveY * bl[0], bl[1] - tl[1] + perspectiveY * bl[1]];
	return (u, v) => {
		const denominator = perspectiveX * u + perspectiveY * v + 1;
		const [bx, by] = bilinear(u, v);
		const px = (acrossTop[0]! * u + downLeft[0]! * v + tl[0]) / denominator;
		const py = (acrossTop[1]! * u + downLeft[1]! * v + tl[1]) / denominator;
		return [px + (bx - px) * blend, py + (by - py) * blend];
	};
}
