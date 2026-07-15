import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const CACHE_DIR = resolve(import.meta.dirname, '.cache');

export interface CachedResponse {
	status: number;
	contentType: string;
	body: string; // base64
}

function getCachePath(url: string): string {
	const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
	return resolve(CACHE_DIR, hash + '.json');
}

export function ensureCacheDir(): void {
	mkdirSync(CACHE_DIR, { recursive: true });
}

export function readCache(url: string): CachedResponse | null {
	const cachePath = getCachePath(url);
	if (!existsSync(cachePath)) return null;
	return JSON.parse(readFileSync(cachePath, 'utf-8')) as CachedResponse;
}

export function writeCache(url: string, entry: CachedResponse): void {
	writeFileSync(getCachePath(url), JSON.stringify({ url, ...entry }));
}

// --- Node.js fetch patching ---

const originalFetch = globalThis.fetch;

function cachedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const url =
		typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

	const cached = readCache(url);
	if (cached) {
		const body = Buffer.from(cached.body, 'base64');
		return Promise.resolve(
			new Response(body, {
				status: cached.status,
				headers: { 'content-type': cached.contentType },
			}),
		);
	}

	return originalFetch(input, init).then(async (response) => {
		const buffer = await response.arrayBuffer();
		const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
		// Only cache successful, non-empty responses. Caching errors or truncated
		// bodies would poison the cache permanently and defeat any retry logic.
		if (response.ok && buffer.byteLength > 0) {
			writeCache(url, {
				status: response.status,
				contentType,
				body: Buffer.from(buffer).toString('base64'),
			});
		}
		return new Response(buffer, {
			status: response.status,
			headers: { 'content-type': contentType },
		});
	});
}

export function installFetchCache(): void {
	ensureCacheDir();
	globalThis.fetch = cachedFetch;
}

export function uninstallFetchCache(): void {
	globalThis.fetch = originalFetch;
}
