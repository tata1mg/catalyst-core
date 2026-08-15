/**
 * Client-only, size-bounded memoization of loader promises, keyed by route data
 * key (matches `disableCaching`'s existing route-key convention in
 * RouterDataProvider.jsx). Re-renders — including React re-rendering a suspended
 * component once its lazy chunk and/or loader promise resolves — read the same
 * cached promise instead of re-invoking the loader; a prefetch (PrefetchLink) can
 * warm an entry ahead of navigation actually needing it.
 *
 * Deliberately guarded to `typeof window`: a module-scope cache on the server
 * would leak one request's loader promises into a concurrent, unrelated request
 * — the same class of bug documented in requestContext.js (module-scope state
 * must never be shared across requests). Server callers get a fresh,
 * per-request map from buildLoaderPromiseMap.js instead; this module is a no-op
 * there (see `getOrRunLoaderPromise`'s early return).
 *
 * Bounded LRU (default 100 entries): a `Map` preserves insertion order, and a
 * cache hit deletes-then-re-sets its entry to move it to the most-recently-used
 * end, so `evict()` dropping from the front always removes the least-recently-used
 * entry. Each entry also carries an optional `staleTime` — a cached promise older
 * than that is treated as a miss and the loader re-runs, superseding the
 * page-level `disableCaching` boolean this replaces.
 */

const DEFAULT_MAX_ENTRIES = 100

export class LoaderCache {
    constructor({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
        this.maxEntries = maxEntries
        this.entries = new Map()
    }

    get size() {
        return this.entries.size
    }

    has(key) {
        return this.entries.has(key) && !this.isStale(this.entries.get(key))
    }

    isStale(entry) {
        return entry.expiresAt !== Infinity && Date.now() > entry.expiresAt
    }

    /**
     * A cache hit here is also the dedup path: two calls for the same key
     * arriving before the first has settled both land on the same in-flight
     * promise, because `set()` below stores it synchronously, before either
     * caller yields to a microtask — the second call's `has(key)` check always
     * sees it. No separate in-flight-tracking structure needed.
     *
     * @param {string} key
     * @param {(signal: AbortSignal) => Promise<any>} runLoader - receives an AbortSignal that fires if `abort(key)` is called before this entry settles
     * @param {{ staleTime?: number }} [options] - ms before this entry is treated as a miss; omit/Infinity to never expire on its own (still subject to LRU eviction)
     */
    getOrRun(key, runLoader, { staleTime = Infinity } = {}) {
        if (this.has(key)) {
            const entry = this.entries.get(key)
            // Move to the most-recently-used end.
            this.entries.delete(key)
            this.entries.set(key, entry)
            return entry.promise
        }

        const controller = new AbortController()
        const promise = runLoader(controller.signal)
        this.set(key, promise, staleTime, controller)
        return promise
    }

    set(key, promise, staleTime = Infinity, controller = null) {
        this.entries.delete(key)
        this.entries.set(key, {
            promise,
            expiresAt: staleTime === Infinity ? Infinity : Date.now() + staleTime,
            controller,
        })
        this.evict()
    }

    delete(key) {
        this.entries.delete(key)
    }

    /**
     * Aborts the in-flight loader for `key` (a no-op if it already settled or
     * was never given a controller — `set()` called directly, without going
     * through `getOrRun`, has none) and removes the entry, so a future request
     * for the same key starts fresh rather than resolving to a cancelled call.
     *
     * @param {string} key
     */
    abort(key) {
        const entry = this.entries.get(key)
        entry?.controller?.abort()
        this.entries.delete(key)
    }

    clear() {
        this.entries.clear()
    }

    evict() {
        while (this.entries.size > this.maxEntries) {
            const oldestKey = this.entries.keys().next().value
            this.entries.delete(oldestKey)
        }
    }
}

const loaderCache = typeof window !== "undefined" ? new LoaderCache() : null

/**
 * @param {string} key
 * @param {(signal: AbortSignal) => Promise<any>} runLoader
 * @param {{ staleTime?: number }} [options]
 */
export const getOrRunLoaderPromise = (key, runLoader, options) => {
    if (!loaderCache) return runLoader(new AbortController().signal)
    return loaderCache.getOrRun(key, runLoader, options)
}

/**
 * Aborts and evicts the in-flight loader cached under `key`, if any. A no-op
 * outside a browser environment or if nothing is cached under that key.
 *
 * @param {string} key
 */
export const abortLoaderPromise = (key) => {
    loaderCache?.abort(key)
}

export const clearLoaderCache = () => loaderCache?.clear()
