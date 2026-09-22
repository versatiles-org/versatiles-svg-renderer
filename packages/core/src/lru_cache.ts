interface Entry<V> {
	promise: Promise<V>;
	settled: boolean;
	size: number;
}

/**
 * An in-memory cache of values that are loaded asynchronously, holding up to `maxSize`
 * (in whatever unit `sizeOf` measures, usually bytes) and dropping the least recently used
 * values first.
 *
 * - It stores promises, so requests for a value that is still loading share one load.
 * - A load that rejects is not kept, and neither is a value for which `sizeOf` returns
 *   `undefined`, nor one larger than the whole cache: the next request loads them again.
 */
export class LRUCache<V> {
	readonly #maxSize: number;
	readonly #sizeOf: (value: V) => number | undefined;
	/** In least recently used order. */
	readonly #entries = new Map<string, Entry<V>>();
	#size = 0;

	public constructor(maxSize: number, sizeOf: (value: V) => number | undefined) {
		this.#maxSize = maxSize;
		this.#sizeOf = sizeOf;
	}

	/** Total size of the values held. */
	public get size(): number {
		return this.#size;
	}

	/** Number of values held, including ones still loading. */
	public get count(): number {
		return this.#entries.size;
	}

	/** The value for `key`: kept, still loading, or loaded now by `load`. */
	public getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
		const cached = this.#entries.get(key);
		if (cached) {
			// Re-insert, so the map stays in least recently used order.
			this.#entries.delete(key);
			this.#entries.set(key, cached);
			return cached.promise;
		}

		const entry: Entry<V> = { promise: load(), settled: false, size: 0 };
		this.#entries.set(key, entry);
		entry.promise.then(
			(value) => this.#settle(key, entry, this.#sizeOf(value)),
			() => this.#settle(key, entry, undefined),
		);
		return entry.promise;
	}

	/** Drops every value. Loads still running are not kept when they finish. */
	public clear(): void {
		this.#entries.clear();
		this.#size = 0;
	}

	#settle(key: string, entry: Entry<V>, size: number | undefined): void {
		// Cleared, or evicted, while loading.
		if (this.#entries.get(key) !== entry) return;

		if (size === undefined || size > this.#maxSize) {
			this.#entries.delete(key);
			return;
		}
		entry.settled = true;
		entry.size = size;
		this.#size += size;
		this.#evict();
	}

	#evict(): void {
		for (const [key, entry] of this.#entries) {
			if (this.#size <= this.#maxSize) return;
			// Values still loading take no space yet, and keep sharing their load.
			if (!entry.settled) continue;
			this.#entries.delete(key);
			this.#size -= entry.size;
		}
	}
}
