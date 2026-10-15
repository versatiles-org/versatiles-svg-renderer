/**
 * The part of a `Response` the renderer uses. A real `Response` has all of it; the type
 * is spelled out so that using this package needs neither the DOM nor Node's type
 * definitions.
 */
export interface FetchResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly headers: { get(name: string): string | null };
	arrayBuffer(): Promise<ArrayBuffer>;
	json(): Promise<unknown>;
}

/**
 * The part of `fetch`'s `RequestInit` the renderer passes. It sends request headers only
 * to read part of a file: a `Range` header for a PMTiles archive.
 */
export interface FetchRequestInit {
	headers?: Record<string, string>;
}

/**
 * Loads a URL, like `fetch`: the renderer loads tiles, sprites, TileJSON documents and GeoJSON data through it. It is called
 * with the URL, and for part of a file with request headers as well, and should resolve to
 * a `Response`.
 */
export type FetchFunction = (url: string, init?: FetchRequestInit) => Promise<FetchResponse>;

/** The global `fetch`, looked up on every call, so that replacing it later takes effect. */
export const defaultFetch: FetchFunction = (url, init) =>
	init ? globalThis.fetch(url, init) : globalThis.fetch(url);

/**
 * `fn` in a form that is safe to store and pass around: it is always called as a plain
 * function. Called as a method instead, the browser's `window.fetch` throws "Illegal
 * invocation".
 */
export function toFetchFunction(fn: FetchFunction | undefined): FetchFunction {
	return fn ? (url, init) => (init ? fn(url, init) : fn(url)) : defaultFetch;
}
