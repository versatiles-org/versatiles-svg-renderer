import { describe, expect, test, vi } from 'vitest';
import { LRUCache } from './lru_cache.js';

const sizeOfString = (value: string): number => value.length;

describe('LRUCache', () => {
	test('loads a value once', async () => {
		const cache = new LRUCache(100, sizeOfString);
		const load = vi.fn(() => Promise.resolve('abc'));
		expect(await cache.getOrLoad('k', load)).toBe('abc');
		expect(await cache.getOrLoad('k', load)).toBe('abc');
		expect(load).toHaveBeenCalledTimes(1);
		expect(cache.size).toBe(3);
	});

	test('shares a load that is still running', async () => {
		const cache = new LRUCache(100, sizeOfString);
		const load = vi.fn(() => Promise.resolve('abc'));
		await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	test('drops a load that rejects, and passes the error on', async () => {
		const cache = new LRUCache(100, sizeOfString);
		await expect(cache.getOrLoad('k', () => Promise.reject(new Error('no')))).rejects.toThrow('no');
		expect(cache.count).toBe(0);
		expect(await cache.getOrLoad('k', () => Promise.resolve('yes'))).toBe('yes');
	});

	test('drops a value whose size is undefined', async () => {
		const cache = new LRUCache<string>(100, () => undefined);
		await cache.getOrLoad('k', () => Promise.resolve('abc'));
		expect(cache.count).toBe(0);
	});

	test('drops the least recently used values beyond its size', async () => {
		const cache = new LRUCache(5, sizeOfString);
		const load = (value: string) => vi.fn(() => Promise.resolve(value));
		await cache.getOrLoad('a', load('aa'));
		await cache.getOrLoad('b', load('bb'));
		await cache.getOrLoad('a', load('aa')); // a is now the most recently used
		await cache.getOrLoad('c', load('cc')); // evicts b
		expect(cache.size).toBe(4);
		const reloadA = load('aa');
		const reloadB = load('bb');
		await cache.getOrLoad('a', reloadA);
		await cache.getOrLoad('b', reloadB);
		expect(reloadA).not.toHaveBeenCalled();
		expect(reloadB).toHaveBeenCalledTimes(1);
	});

	test('does not evict values that are still loading', async () => {
		const cache = new LRUCache(3, sizeOfString);
		let resolve!: (value: string) => void;
		const pending = cache.getOrLoad('slow', () => new Promise((r) => (resolve = r)));
		await cache.getOrLoad('a', () => Promise.resolve('aaa'));
		await cache.getOrLoad('b', () => Promise.resolve('bbb')); // evicts a, not slow
		expect(cache.count).toBe(2);
		resolve('s');
		await pending;
		// Settled, slow (1) + b (3) exceed the size; slow was used least recently, so it goes.
		expect(cache.count).toBe(1);
		expect(cache.size).toBe(3);
	});

	test('clear drops everything, and a running load is not kept', async () => {
		const cache = new LRUCache(100, sizeOfString);
		await cache.getOrLoad('a', () => Promise.resolve('a'));
		let resolve!: (value: string) => void;
		const pending = cache.getOrLoad('b', () => new Promise((r) => (resolve = r)));
		cache.clear();
		resolve('b');
		await pending;
		expect(cache.count).toBe(0);
		expect(cache.size).toBe(0);
	});
});
