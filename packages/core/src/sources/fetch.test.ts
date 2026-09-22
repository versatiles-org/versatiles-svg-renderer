import { afterEach, describe, expect, test, vi } from 'vitest';
import { defaultFetch, toFetchFunction } from './fetch.js';

describe('defaultFetch', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test('uses the global fetch as it is when called', async () => {
		const response = new Response('ok');
		globalThis.fetch = vi.fn(() => Promise.resolve(response));
		expect(await defaultFetch('https://example.com/a')).toBe(response);
		expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/a');
	});
});

describe('toFetchFunction', () => {
	test('gives the default without a function', () => {
		expect(toFetchFunction(undefined)).toBe(defaultFetch);
	});

	test('always calls the function as a plain function', async () => {
		const seen: unknown[] = [];
		const fn = function (this: unknown): Promise<Response> {
			seen.push(this);
			return Promise.resolve(new Response('ok'));
		};
		const holder = { fetch: toFetchFunction(fn) };
		await holder.fetch('https://example.com/a');
		expect(seen).toEqual([undefined]);
	});
});
