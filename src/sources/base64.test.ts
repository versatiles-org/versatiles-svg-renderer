import { describe, it, expect, vi, afterEach } from 'vitest';
import { arrayBufferToBase64 } from './base64.js';

// Capture the real Buffer and native method so the stubs can restore/compare.
const RealBuffer = Buffer;
const proto = Uint8Array.prototype as { toBase64?: () => string };
const nativeToBase64 = proto.toBase64;

function makeBytes(n: number): Uint8Array {
	const bytes = new Uint8Array(n);
	for (let i = 0; i < n; i++) bytes[i] = i % 256;
	return bytes;
}

/** Force the chunked browser fallback: no native method, no Buffer, stubbed btoa. */
function stubBrowserPath(): void {
	delete proto.toBase64;
	vi.stubGlobal('Buffer', undefined);
	vi.stubGlobal('btoa', (s: string) => RealBuffer.from(s, 'binary').toString('base64'));
}

afterEach(() => {
	vi.unstubAllGlobals();
	if (nativeToBase64) proto.toBase64 = nativeToBase64;
	else delete proto.toBase64;
});

describe('arrayBufferToBase64', () => {
	it('encodes a small buffer', () => {
		expect(arrayBufferToBase64(new Uint8Array([104, 105]).buffer)).toBe('aGk=');
	});

	it('encodes an empty buffer', () => {
		expect(arrayBufferToBase64(new Uint8Array([]).buffer)).toBe('');
	});

	it('prefers the native Uint8Array.toBase64 when present', () => {
		const spy = vi.fn(() => 'NATIVE');
		proto.toBase64 = spy;
		expect(arrayBufferToBase64(new Uint8Array([1, 2, 3]).buffer)).toBe('NATIVE');
		expect(spy).toHaveBeenCalledOnce();
	});

	it('uses Buffer when the native method is absent (Node path)', () => {
		delete proto.toBase64;
		const bytes = makeBytes(1000);
		expect(arrayBufferToBase64(bytes.buffer)).toBe(RealBuffer.from(bytes).toString('base64'));
	});

	it('matches the reference output on the chunked browser path', () => {
		const bytes = makeBytes(1000);
		const expected = RealBuffer.from(bytes).toString('base64');
		stubBrowserPath();
		expect(arrayBufferToBase64(bytes.buffer)).toBe(expected);
	});

	it('does not overflow the argument limit on large buffers (browser path)', () => {
		// Far larger than the ~64K argument-count limit a naive
		// String.fromCharCode(...bytes) spread would hit.
		const bytes = makeBytes(500_000);
		const expected = RealBuffer.from(bytes).toString('base64');
		stubBrowserPath();
		expect(() => arrayBufferToBase64(bytes.buffer)).not.toThrow();
		expect(arrayBufferToBase64(bytes.buffer)).toBe(expected);
	});
});
