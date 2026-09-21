/**
 * Base64-encode an ArrayBuffer (standard alphabet, with padding).
 *
 * Three paths, all producing identical output:
 *  1. `Uint8Array.prototype.toBase64` — the native method (Node 22+, modern
 *     browsers). Fastest and simplest; used when present.
 *  2. Node's `Buffer` — for Node versions without the native method.
 *  3. Chunked `btoa(String.fromCharCode(...))` — the browser fallback. It must
 *     chunk: spreading a whole tile/sprite PNG at once passes one argument per
 *     byte, overflowing the engine's argument-count limit (Safari ~64K, V8
 *     higher but finite) and throwing `RangeError: Maximum call stack size
 *     exceeded` for buffers above ~64 KB. 32 KB slices stay well under the limit.
 */
export function arrayBufferToBase64(buffer: ArrayBufferLike): string {
	const bytes = new Uint8Array(buffer);

	const toBase64 = (bytes as { toBase64?: () => string }).toBase64;
	if (typeof toBase64 === 'function') return toBase64.call(bytes);

	if (typeof Buffer !== 'undefined') return Buffer.from(buffer).toString('base64');

	const CHUNK_SIZE = 0x8000; // 32 KB, well below the argument-count limit
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
	}
	return btoa(binary);
}
