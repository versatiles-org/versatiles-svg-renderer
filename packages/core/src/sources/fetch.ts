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
 * Loads a URL, like `fetch`: the renderer loads tiles, sprites and TileJSON documents through it. It is called
 * with the URL only, and should resolve to a `Response`.
 */
export type FetchFunction = (url: string) => Promise<FetchResponse>;

/** The global `fetch`, looked up on every call, so that replacing it later takes effect. */
export const defaultFetch: FetchFunction = (url) => globalThis.fetch(url);

/**
 * `fn` in a form that is safe to store and pass around: it is always called as a plain
 * function. Called as a method instead, the browser's `window.fetch` throws "Illegal
 * invocation".
 */
export function toFetchFunction(fn: FetchFunction | undefined): FetchFunction {
	return fn ? (url) => fn(url) : defaultFetch;
}
