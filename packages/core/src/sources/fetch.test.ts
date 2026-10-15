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

	test('passes request headers on', async () => {
		globalThis.fetch = vi.fn(() => Promise.resolve(new Response('ok')));
		const init = { headers: { Range: 'bytes=0-9' } };
		await defaultFetch('https://example.com/a', init);
		expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/a', init);
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

	test('passes request headers on, and calls with the URL only without them', async () => {
		const fn = vi.fn(() => Promise.resolve(new Response('ok')));
		const fetchFn = toFetchFunction(fn);
		await fetchFn('https://example.com/a');
		const init = { headers: { Range: 'bytes=0-9' } };
		await fetchFn('https://example.com/b', init);
		expect(fn.mock.calls).toEqual([['https://example.com/a'], ['https://example.com/b', init]]);
	});
});
