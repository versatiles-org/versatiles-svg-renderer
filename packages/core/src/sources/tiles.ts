import { arrayBufferToBase64 } from './base64.js';
import { defaultFetch, type FetchFunction } from './fetch.js';
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

/**
 * The outcome of fetching a tile. A tile the server does not have (`missing`) will not
 * appear later, so it may be cached; a `failed` fetch (network error, server error, rate
 * limit, …) may succeed when tried again.
 */
export type TileResult =
	{ status: 'ok'; tile: TileResponse } | { status: 'missing' } | { status: 'failed' };

/** Loads one tile, like {@link getTile}; lets a caller put a cache in front of it. */
export type TileLoader = (
	url: string,
	z: number,
	x: number,
	y: number,
) => Promise<TileResponse | null>;

export function resolveTileUrl(url: string, z: number, x: number, y: number): string {
	return url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export async function fetchTile(
	tileUrl: string,
	fetchFn: FetchFunction = defaultFetch,
): Promise<TileResult> {
	try {
		const response = await fetchFn(tileUrl);
		// 204 No Content is how some tile servers answer for an empty tile.
		if (response.status === 404 || response.status === 204) return { status: 'missing' };
		if (!response.ok) return { status: 'failed' };
		const buffer = await response.arrayBuffer();
		const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
		return { status: 'ok', tile: { buffer, contentType } };
	} catch (error: unknown) {
		console.warn(`Failed to load tile: ${tileUrl}`, error);
		return { status: 'failed' };
	}
}

export async function getTile(
	url: string,
	z: number,
	x: number,
	y: number,
	fetchFn: FetchFunction = defaultFetch,
): Promise<TileResponse | null> {
	const result = await fetchTile(resolveTileUrl(url, z, x, y), fetchFn);
	return result.status === 'ok' ? result.tile : null;
}

const dataUris = new WeakMap<TileResponse, string>();

/**
 * The tile as a data URI, built once per tile: a cached tile is the same object in every
 * render, so it is not base64-encoded again.
 */
export function tileDataUri(tile: TileResponse): string {
	let dataUri = dataUris.get(tile);
	if (dataUri === undefined) {
		dataUri = `data:${tile.contentType};base64,${arrayBufferToBase64(tile.buffer)}`;
		dataUris.set(tile, dataUri);
	}
	return dataUri;
}
