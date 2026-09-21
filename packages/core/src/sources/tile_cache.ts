import {
	fetchTile,
	resolveTileUrl,
	type TileLoader,
	type TileResponse,
	type TileResult,
} from './tiles.js';

/** What a tile the server does not have counts towards the cache size, in bytes. */
const MISSING_TILE_SIZE = 64;

interface Entry {
	promise: Promise<TileResponse | null>;
	/** 0 while the tile is still loading. */
	size: number;
}

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
	readonly #maxBytes: number;
	readonly #entries = new Map<string, Entry>();
	#bytes = 0;

	public constructor(maxBytes: number) {
		if (!(maxBytes >= 0)) throw new Error('tileCacheSize must be a number ≥ 0');
		this.#maxBytes = maxBytes;
	}

	/** Total size of the tiles held, in bytes. */
	public get bytes(): number {
		return this.#bytes;
	}

	/** Number of tiles held, including ones still loading. */
	public get count(): number {
		return this.#entries.size;
	}

	public readonly load: TileLoader = (url, z, x, y) => {
		const key = resolveTileUrl(url, z, x, y);
		const cached = this.#entries.get(key);
		if (cached) {
			// Re-insert, so the map's order stays least recently used first.
			this.#entries.delete(key);
			this.#entries.set(key, cached);
			return cached.promise;
		}

		const entry: Entry = { promise: Promise.resolve(null), size: 0 };
		entry.promise = fetchTile(key)
			.catch((): TileResult => ({ status: 'failed' }))
			.then((result) => {
				this.#settle(key, entry, result);
				return result.status === 'ok' ? result.tile : null;
			});
		this.#entries.set(key, entry);
		return entry.promise;
	};

	/** Drops every tile. Fetches still running are not remembered when they finish. */
	public clear(): void {
		this.#entries.clear();
		this.#bytes = 0;
	}

	#settle(key: string, entry: Entry, result: TileResult): void {
		// Cleared, or evicted, while loading.
		if (this.#entries.get(key) !== entry) return;

		const size = result.status === 'ok' ? tileSize(result.tile) : MISSING_TILE_SIZE;
		if (result.status === 'failed' || size > this.#maxBytes) {
			this.#entries.delete(key);
			return;
		}
		entry.size = size;
		this.#bytes += size;
		this.#evict();
	}

	#evict(): void {
		for (const [key, entry] of this.#entries) {
			if (this.#bytes <= this.#maxBytes) return;
			// Tiles still loading take no space yet, and keep sharing their fetch.
			if (entry.size === 0) continue;
			this.#entries.delete(key);
			this.#bytes -= entry.size;
		}
	}
}

/** Memory a tile takes: its data, plus the base64 data URI a raster tile is drawn from. */
function tileSize(tile: TileResponse): number {
	const bytes = tile.buffer.byteLength;
	if (!tile.contentType.startsWith('image/')) return bytes;
	// A JS string takes 2 bytes per character in the worst case, but base64 is ASCII, which
	// engines store at 1 byte per character.
	return bytes + Math.ceil(bytes / 3) * 4;
}
