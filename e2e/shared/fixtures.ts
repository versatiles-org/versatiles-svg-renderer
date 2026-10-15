/**
 * Files the e2e tests make themselves (such as the symbols scene's sprite), served under an
 * origin that does not exist. Both paths that load a style's files ask here first: `fetch`
 * in Node (`fetch-cache.ts`), for the renderers, and the browser pages (`../visual/capture.ts`),
 * for MapLibre.
 */

/** Where the fixtures are served; a URL under it that names no fixture answers 404. */
export const FIXTURES_URL = 'https://e2e.invalid/';

interface Fixture {
	contentType: string;
	/** Makes the file's content, when it is first asked for. */
	make: () => Buffer;
	body?: Buffer;
}

const fixtures = new Map<string, Fixture>();

/**
 * Adds a fixture at `path` (relative to {@link FIXTURES_URL}), made by `make` or given as
 * it is. Returns its URL.
 */
export function addFixture(
	path: string,
	contentType: string,
	make: (() => Buffer) | Buffer,
): string {
	const url = new URL(path, FIXTURES_URL).href;
	fixtures.set(
		url,
		Buffer.isBuffer(make) ? { contentType, make: () => make, body: make } : { contentType, make },
	);
	return url;
}

/**
 * The answer to a request of `url` if it is under {@link FIXTURES_URL}, else `undefined`.
 * With a `range` header (`bytes=<first>-<last>`, as a PMTiles reader sends it), only that
 * part of the file.
 */
export function readFixture(
	url: string,
	range?: string | null,
): { status: number; contentType: string; body: Buffer } | undefined {
	if (!url.startsWith(FIXTURES_URL)) return undefined;
	const fixture = fixtures.get(url);
	if (!fixture) return { status: 404, contentType: 'text/plain', body: Buffer.from('not found') };
	fixture.body ??= fixture.make();
	const match = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
	if (!match) return { status: 200, contentType: fixture.contentType, body: fixture.body };
	const [first, last] = [Number(match[1]), Number(match[2])];
	return {
		status: 206,
		contentType: fixture.contentType,
		body: fixture.body.subarray(first, last + 1),
	};
}
