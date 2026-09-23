import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FetchFunction } from './fetch.js';

type Sources = StyleSpecification['sources'];

/** Source types whose `url` points at a TileJSON document. */
const TILED_TYPES = new Set(['vector', 'raster', 'raster-dem']);

/** The TileJSON keys MapLibre GL JS takes over into a source. */
const TILEJSON_KEYS = [
	'tiles',
	'minzoom',
	'maxzoom',
	'bounds',
	'scheme',
	'tileSize',
	'encoding',
	'attribution',
] as const;

/**
 * The style's sources, with each TileJSON source (one with a `url`) completed from its
 * TileJSON document, as MapLibre GL JS does: `tiles`, `minzoom`, `maxzoom` and the like are
 * taken from the document, but values set in the style win.
 *
 * A TileJSON document that cannot be loaded leaves its source as it is, without tiles, and
 * makes the result not `complete`, so a caller that caches it can try again.
 */
export async function resolveSources(
	sources: Sources,
	fetchFn: FetchFunction,
): Promise<{ sources: Sources; complete: boolean }> {
	let complete = true;
	const entries = await Promise.all(
		Object.entries(sources).map(async ([name, source]) => {
			const url = (source as { url?: unknown }).url;
			if (!TILED_TYPES.has(source.type) || typeof url !== 'string') return [name, source];
			const tileJSON = await fetchTileJSON(url, fetchFn);
			if (!tileJSON) {
				complete = false;
				return [name, source];
			}
			return [name, { ...pickTileJSON(tileJSON, url), ...source }];
		}),
	);
	return { sources: Object.fromEntries(entries) as Sources, complete };
}

async function fetchTileJSON(
	url: string,
	fetchFn: FetchFunction,
): Promise<Record<string, unknown> | undefined> {
	try {
		const response = await fetchFn(url);
		if (!response.ok) return undefined;
		const json = await response.json();
		if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
		return json as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/** The keys of `tileJSON` a source takes over, with tile URLs resolved against `url`. */
function pickTileJSON(tileJSON: Record<string, unknown>, url: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of TILEJSON_KEYS) {
		if (tileJSON[key] !== undefined) result[key] = tileJSON[key];
	}
	if (Array.isArray(result.tiles)) {
		result.tiles = result.tiles
			.filter((tile): tile is string => typeof tile === 'string')
			.map((tile) => resolveTileUrlTemplate(tile, url));
	}
	return result;
}

/**
 * Resolves a tile URL template that is relative to the TileJSON document at `base`,
 * keeping its placeholders (`{z}`, `{x}`, `{y}`, …), which `URL` would percent-encode.
 */
export function resolveTileUrlTemplate(template: string, base: string): string {
	if (/^[a-z][a-z0-9+.-]*:/i.test(template)) return template;
	try {
		return new URL(template, base).href.replace(/%7B([\w-]+)%7D/gi, '{$1}');
	} catch {
		return template;
	}
}
