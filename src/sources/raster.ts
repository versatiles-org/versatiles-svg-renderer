import type { RenderJob, RasterTile } from '../renderer/svg.js';
import { calculateTileGrid, getTile } from './tiles.js';

export async function getRasterTiles(job: RenderJob, sourceName: string): Promise<RasterTile[]> {
	const { width, height } = job.renderer;
	const { zoom, center } = job.view;
	const source = job.style.sources[sourceName] as
		{ type: string; tiles?: string[]; maxzoom?: number } | undefined;

	if (source?.type !== 'raster' || !source.tiles) {
		throw Error(
			`Invalid raster source "${sourceName}": expected type "raster" with a "tiles" array`,
		);
	}

	const sourceUrl = source.tiles[0]!;
	const { zoomLevel, tileSize, tiles } = calculateTileGrid(
		width,
		height,
		center,
		zoom,
		source.maxzoom,
	);

	const rasterTiles = await Promise.all(
		tiles.map(async ({ x, y, offsetX, offsetY }): Promise<RasterTile | null> => {
			const tile = await getTile(sourceUrl, zoomLevel, x, y);
			if (!tile) return null;

			const base64 =
				typeof Buffer !== 'undefined'
					? Buffer.from(tile.buffer).toString('base64')
					: btoa(String.fromCharCode(...new Uint8Array(tile.buffer)));
			const dataUri = `data:${tile.contentType};base64,${base64}`;

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
