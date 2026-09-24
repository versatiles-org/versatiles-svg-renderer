import type { RenderJob, RasterTile } from '../renderer/svg.js';
import type { RasterTriangle } from '../renderer/types.js';
import {
	calculateTileGrid,
	getTile,
	loadSourceTile,
	tileDataUri,
	type TiledSource,
	type TileLoader,
} from './tiles.js';

export async function getRasterTiles(
	job: RenderJob,
	sourceName: string,
	loadTile: TileLoader = getTile,
): Promise<RasterTile[]> {
	const { width, height } = job.renderer;
	const { zoom, center } = job.view;
	const source = job.style.sources[sourceName] as
		(Partial<TiledSource> & { type: string; url?: string; maxzoom?: number }) | undefined;

	// A TileJSON source whose document could not be loaded: drawn empty, like a vector source.
	if (source?.type === 'raster' && !source.tiles && typeof source.url === 'string') return [];

	if (source?.type !== 'raster' || !source.tiles) {
		throw Error(
			`Invalid raster source "${sourceName}": expected type "raster" with a "tiles" array`,
		);
	}

	const tiled = { ...source, tiles: source.tiles };

	const projection = job.projection;
	if (projection?.isGlobe) {
		// Never zoom level 0 on the globe: the left and right edge of its single tile coincide
		// (the antimeridian), which the horizon clipping cannot tell apart.
		const z = Math.max(1, Math.min(Math.floor(zoom), source.maxzoom ?? Infinity));
		const globeTiles = await Promise.all(
			projection.coveringTiles(z).map(async (id): Promise<RasterTile | null> => {
				const tile = await loadSourceTile(tiled, id.z, id.x, id.y, loadTile);
				if (!tile) return null;
				const triangles = projection.rasterTriangles(id);
				if (triangles.length === 0) return null;
				const dataUri = tileDataUri(tile);
				return { x: 0, y: 0, width: 1, height: 1, dataUri, triangles };
			}),
		);
		return globeTiles.filter((tile): tile is RasterTile => tile !== null);
	}
	// A turned or moved map (bearing, padding) needs the tiles of the north-up area around
	// the image. Turned, each is drawn as two triangles turned into place; moved only, it is
	// simply moved.
	const moved = projection?.isTransformed ? projection : undefined;
	const rotated = moved !== undefined && moved.bearing !== 0;
	const covered = moved ? moved.coveredSize : { width, height };
	const shiftX = (width - covered.width) / 2;
	const shiftY = (height - covered.height) / 2;
	const { zoomLevel, tileSize, tiles } = calculateTileGrid(
		covered.width,
		covered.height,
		center,
		zoom,
		source.maxzoom,
	);

	const rasterTiles = await Promise.all(
		tiles.map(async ({ x, y, offsetX, offsetY }): Promise<RasterTile | null> => {
			const tile = await loadSourceTile(tiled, zoomLevel, x, y, loadTile);
			if (!tile) return null;

			const dataUri = tileDataUri(tile);

			if (rotated) {
				const corner = (u: number, v: number): [number, number] => {
					const p = moved.fromNorthUp(
						offsetX + shiftX + u * tileSize,
						offsetY + shiftY + v * tileSize,
					);
					return [p.x, p.y];
				};
				const [p00, p10, p11, p01] = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
				const triangles: RasterTriangle[] = [
					{
						source: [
							[0, 0],
							[1, 0],
							[1, 1],
						],
						target: [p00, p10, p11],
					},
					{
						source: [
							[0, 0],
							[1, 1],
							[0, 1],
						],
						target: [p00, p11, p01],
					},
				];
				return { x: 0, y: 0, width: 1, height: 1, dataUri, triangles };
			}

			const [moveX, moveY] = moved ? moved.offset : [0, 0];
			return {
				x: offsetX + shiftX + moveX,
				y: offsetY + shiftY + moveY,
				width: tileSize,
				height: tileSize,
				dataUri,
			};
		}),
	);

	return rasterTiles.filter((tile): tile is RasterTile => tile !== null);
}
