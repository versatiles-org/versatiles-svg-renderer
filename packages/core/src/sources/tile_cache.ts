import { LRUCache } from '../lru_cache.js';
import {
	fetchTile,
	resolveTileUrl,
	type TileLoader,
	type TileResponse,
	type TileResult,
} from './tiles.js';

/** What a tile the server does not have counts towards the cache size, in bytes. */
const MISSING_TILE_SIZE = 64;

/**
 * Keeps fetched tiles in memory, so that rendering overlapping views does not fetch them
 * again. Holds up to `maxBytes`, dropping the least recently used tiles first.
 *
 * - Requests for a tile that is still loading share its fetch, even with `maxBytes = 0`.
 * - A tile the server does not have (404, 204) is remembered as missing; a failed fetch is
 *   not remembered, so the next request tries again.
 * - Raster tiles are counted with the base64 copy {@link tileDataUri} makes of them, so
 *   the limit is close to the memory they take.
 */
export class TileCache {
	readonly #cache: LRUCache<TileResult>;

	public constructor(maxBytes: number) {
		if (!(maxBytes >= 0)) throw new Error('tileCacheSize must be a number ≥ 0');
		this.#cache = new LRUCache(maxBytes, resultSize);
	}

	/** Total size of the tiles held, in bytes. */
	public get bytes(): number {
		return this.#cache.size;
	}

	/** Number of tiles held, including ones still loading. */
	public get count(): number {
		return this.#cache.count;
	}

	public readonly load: TileLoader = async (url, z, x, y) => {
		const key = resolveTileUrl(url, z, x, y);
		const result = await this.#cache.getOrLoad(key, () => fetchTile(key));
		return result.status === 'ok' ? result.tile : null;
	};

	/** Drops every tile. Fetches still running are not remembered when they finish. */
	public clear(): void {
		this.#cache.clear();
	}
}

function resultSize(result: TileResult): number | undefined {
	switch (result.status) {
		case 'ok':
			return tileSize(result.tile);
		case 'missing':
			return MISSING_TILE_SIZE;
		case 'failed':
			return undefined;
	}
}

/** Memory a tile takes: its data, plus the base64 data URI a raster tile is drawn from. */
function tileSize(tile: TileResponse): number {
	const bytes = tile.buffer.byteLength;
	if (!tile.contentType.startsWith('image/')) return bytes;
	// Base64 is ASCII, which JS engines store at 1 byte per character.
	return bytes + Math.ceil(bytes / 3) * 4;
}
