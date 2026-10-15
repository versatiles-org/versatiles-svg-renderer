import { PMTiles, TileType, type RangeResponse, type Source } from 'pmtiles';
import type { FetchFunction, FetchResponse } from './fetch.js';

/** The scheme of a PMTiles source's `url`, as registered by the `pmtiles` package for MapLibre GL JS. */
const PREFIX = 'pmtiles://';

/** A tile URL of an archive: `pmtiles://<archive URL>/<z>/<x>/<y>`, as {@link PREFIX} plus the TileJSON's template. */
const TILE_URL = /^pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/;

/** Content types of the archive's tile types, as a tile server would send them. */
const CONTENT_TYPES: Partial<Record<TileType, string>> = {
	[TileType.Mvt]: 'application/x-protobuf',
	[TileType.Png]: 'image/png',
	[TileType.Jpeg]: 'image/jpeg',
	[TileType.Webp]: 'image/webp',
	[TileType.Avif]: 'image/avif',
};

/** Whether `url` points into a PMTiles archive (`pmtiles://…`). */
export function isPMTilesUrl(url: string): boolean {
	return url.startsWith(PREFIX);
}

/**
 * Reads PMTiles archives, as the `pmtiles` package's protocol does for MapLibre GL JS, and
 * answers like a tile server, so the renderer loads them as any other source:
 *
 * - `pmtiles://<archive URL>` is the archive's TileJSON document: its tiles, zoom levels
 *   and bounds, from the archive's header.
 * - `pmtiles://<archive URL>/<z>/<x>/<y>` is a tile; one the archive does not have is a 404.
 *
 * Every other URL goes to the wrapped `fetch`, which also reads the archives, with HTTP
 * range requests. An archive's header and directories are kept until {@link clear}; an
 * archive that failed to load is loaded again by the next request.
 */
export class PMTilesProtocol {
	readonly #fetch: FetchFunction;
	readonly #archives = new Map<string, PMTiles>();

	public constructor(fetchFn: FetchFunction) {
		this.#fetch = fetchFn;
	}

	public readonly fetch: FetchFunction = (url, init) => {
		if (!isPMTilesUrl(url)) return init ? this.#fetch(url, init) : this.#fetch(url);
		const match = TILE_URL.exec(url);
		if (!match) return this.#tileJSON(url.slice(PREFIX.length));
		const [, archiveUrl, z, x, y] = match as unknown as [string, string, string, string, string];
		return this.#tile(archiveUrl, Number(z), Number(x), Number(y));
	};

	/** Forgets the archives' headers and directories. */
	public clear(): void {
		this.#archives.clear();
	}

	async #tileJSON(archiveUrl: string): Promise<FetchResponse> {
		const header = await this.#read(archiveUrl, (archive) => archive.getHeader());
		return jsonResponse({
			tiles: [`${PREFIX}${archiveUrl}/{z}/{x}/{y}`],
			minzoom: header.minZoom,
			maxzoom: header.maxZoom,
			bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
		});
	}

	async #tile(archiveUrl: string, z: number, x: number, y: number): Promise<FetchResponse> {
		const [header, tile] = await this.#read(archiveUrl, (archive) =>
			Promise.all([archive.getHeader(), archive.getZxy(z, x, y)]),
		);
		if (!tile) return emptyResponse(404);
		const contentType = CONTENT_TYPES[header.tileType] ?? 'application/octet-stream';
		return bufferResponse(tile.data, contentType);
	}

	/** `read` of the archive at `url`, which is dropped if it fails, so the next request tries again. */
	async #read<T>(url: string, read: (archive: PMTiles) => Promise<T>): Promise<T> {
		let archive = this.#archives.get(url);
		if (!archive) {
			archive = new PMTiles(new FetchSource(url, this.#fetch));
			this.#archives.set(url, archive);
		}
		try {
			return await read(archive);
		} catch (error: unknown) {
			if (this.#archives.get(url) === archive) this.#archives.delete(url);
			throw error;
		}
	}
}

/** Reads byte ranges of the archive at `url` through `fetchFn`. */
class FetchSource implements Source {
	readonly #url: string;
	readonly #fetch: FetchFunction;

	public constructor(url: string, fetchFn: FetchFunction) {
		this.#url = url;
		this.#fetch = fetchFn;
	}

	public getKey(): string {
		return this.#url;
	}

	public async getBytes(offset: number, length: number): Promise<RangeResponse> {
		const response = await this.#fetch(this.#url, {
			headers: { Range: `bytes=${String(offset)}-${String(offset + length - 1)}` },
		});
		if (!response.ok) {
			throw new Error(`Failed to load ${this.#url}: status ${String(response.status)}`);
		}
		const data = await response.arrayBuffer();
		// A server (or a `fetch` passed in) that ignores the range sends the whole file.
		if (response.status === 200) return { data: data.slice(offset, offset + length) };
		return { data };
	}
}

function jsonResponse(body: unknown): FetchResponse {
	const text = JSON.stringify(body);
	return {
		ok: true,
		status: 200,
		headers: headers('application/json'),
		arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer),
		json: () => Promise.resolve(JSON.parse(text) as unknown),
	};
}

function bufferResponse(data: ArrayBuffer, contentType: string): FetchResponse {
	return {
		ok: true,
		status: 200,
		headers: headers(contentType),
		arrayBuffer: () => Promise.resolve(data),
		json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(data)) as unknown),
	};
}

function emptyResponse(status: number): FetchResponse {
	return {
		ok: false,
		status,
		headers: headers(undefined),
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
		json: () => Promise.reject(new Error('No content')),
	};
}

function headers(contentType: string | undefined): FetchResponse['headers'] {
	return {
		get: (name) => (name.toLowerCase() === 'content-type' ? (contentType ?? null) : null),
	};
}
