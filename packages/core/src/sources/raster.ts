import type { RenderJob, RasterTile } from '../renderer/svg.js';
import { calculateTileGrid, getTile, tileDataUri, type TileLoader } from './tiles.js';

export async function getRasterTiles(
	job: RenderJob,
	sourceName: string,
	loadTile: TileLoader = getTile,
): Promise<RasterTile[]> {
	const { width, height } = job.renderer;
	const { zoom, center } = job.view;
	const source = job.style.sources[sourceName] as
		{ type: string; tiles?: string[]; url?: string; maxzoom?: number } | undefined;

	// A TileJSON source whose document could not be loaded: drawn empty, like a vector source.
	if (source?.type === 'raster' && !source.tiles && typeof source.url === 'string') return [];

	if (source?.type !== 'raster' || !source.tiles) {
		throw Error(
			`Invalid raster source "${sourceName}": expected type "raster" with a "tiles" array`,
		);
	}

	const sourceUrl = source.tiles[0]!;

	const projection = job.projection;
	if (projection?.isGlobe) {
		// Never zoom level 0 on the globe: the left and right edge of its single tile coincide
		// (the antimeridian), which the horizon clipping cannot tell apart.
		const z = Math.max(1, Math.min(Math.floor(zoom), source.maxzoom ?? Infinity));
		const globeTiles = await Promise.all(
			projection.coveringTiles(z).map(async (id): Promise<RasterTile | null> => {
				const tile = await loadTile(sourceUrl, id.z, id.x, id.y);
				if (!tile) return null;
				const triangles = projection.rasterTriangles(id);
				if (triangles.length === 0) return null;
				const dataUri = tileDataUri(tile);
				return { x: 0, y: 0, width: 1, height: 1, dataUri, triangles };
			}),
		);
		return globeTiles.filter((tile): tile is RasterTile => tile !== null);
	}
	const { zoomLevel, tileSize, tiles } = calculateTileGrid(
		width,
		height,
		center,
		zoom,
		source.maxzoom,
	);

	const rasterTiles = await Promise.all(
		tiles.map(async ({ x, y, offsetX, offsetY }): Promise<RasterTile | null> => {
			const tile = await loadTile(sourceUrl, zoomLevel, x, y);
			if (!tile) return null;

			const dataUri = tileDataUri(tile);

			return {
				x: offsetX,
				y: offsetY,
				width: tileSize,
				height: tileSize,
				dataUri,
			};
		}),
	);

	return rasterTiles.filter((tile): tile is RasterTile => tile !== null);
}
