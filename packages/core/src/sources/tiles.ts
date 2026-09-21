import { Point2D } from '../geometry.js';

export interface TileInfo {
	x: number;
	y: number;
	offsetX: number;
	offsetY: number;
}

export interface TileGrid {
	zoomLevel: number;
	tileSize: number;
	tiles: TileInfo[];
}

export function calculateTileGrid(
	width: number,
	height: number,
	center: [number, number],
	zoom: number,
	maxzoom?: number,
): TileGrid {
	const zoomLevel = Math.min(Math.floor(zoom), maxzoom ?? Infinity);
	const tileCenterCoordinate = new Point2D(center[0], center[1])
		.getProject2Pixel()
		.scale(2 ** zoomLevel);
	const tileSize = 2 ** (zoom - zoomLevel + 9); // 512 (2^9) is the standard tile size

	const tileCols = width / tileSize;
	const tileRows = height / tileSize;
	const tileMinX = Math.floor(tileCenterCoordinate.x - tileCols / 2);
	const tileMinY = Math.floor(tileCenterCoordinate.y - tileRows / 2);
	const tileMaxX = Math.floor(tileCenterCoordinate.x + tileCols / 2);
	const tileMaxY = Math.floor(tileCenterCoordinate.y + tileRows / 2);

	const tilesPerZoom = 2 ** zoomLevel;
	const tiles: TileInfo[] = [];
	for (let x = tileMinX; x <= tileMaxX; x++) {
		const wrappedX = ((x % tilesPerZoom) + tilesPerZoom) % tilesPerZoom;
		for (let y = tileMinY; y <= tileMaxY; y++) {
			if (y < 0 || y >= tilesPerZoom) continue;
			tiles.push({
				x: wrappedX,
				y,
				offsetX: width / 2 + (x - tileCenterCoordinate.x) * tileSize,
				offsetY: height / 2 + (y - tileCenterCoordinate.y) * tileSize,
			});
		}
	}

	return { zoomLevel, tileSize, tiles };
}

export interface TileResponse {
	buffer: ArrayBuffer;
	contentType: string;
}

export async function getTile(
	url: string,
	z: number,
	x: number,
	y: number,
): Promise<TileResponse | null> {
	const tileUrl = url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
	try {
		const response = await fetch(tileUrl);
		if (!response.ok) return null;
		const buffer = await response.arrayBuffer();
		const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
		return { buffer, contentType };
	} catch (error: unknown) {
		console.warn(`Failed to load tile: ${tileUrl}`, error);
		return null;
	}
}
