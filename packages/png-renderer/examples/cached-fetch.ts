/**
 * A `fetch` that keeps tiles on disk between runs, for the `fetch` option of the renderer:
 *
 *   const map = new PNGMapRenderer({ style, fetch: cachedFetch });
 *
 * Every successful response is stored in `tile-cache/`, keyed by a hash of its URL. Files
 * never expire: delete the directory to fetch fresh tiles. A failed request is not stored,
 * so it is tried again next time.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const cacheDir = 'tile-cache';

export async function cachedFetch(url: string): Promise<Response> {
	const file = join(cacheDir, createHash('sha256').update(url).digest('hex'));
	try {
		const { type, body } = JSON.parse(await readFile(file, 'utf8')) as {
			type: string;
			body: string;
		};
		return new Response(Buffer.from(body, 'base64'), { headers: { 'content-type': type } });
	} catch {
		// Not cached yet.
	}
	const response = await fetch(url);
	if (!response.ok) return response;
	const body = Buffer.from(await response.arrayBuffer());
	const type = response.headers.get('content-type') ?? 'application/octet-stream';
	await mkdir(cacheDir, { recursive: true });
	await writeFile(file, JSON.stringify({ type, body: body.toString('base64') }));
	return new Response(body, { headers: { 'content-type': type } });
}
