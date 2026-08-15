import { test } from "node:test"
import assert from "node:assert/strict"
import { LoaderCache, getOrRunLoaderPromise } from "../../../src/web-router/loader/loaderCache.js"

test("getOrRun caches a promise for a key, running the loader only once", () => {
    const cache = new LoaderCache()
    let calls = 0
    const runLoader = () => {
        calls++
        return Promise.resolve(calls)
    }

    const first = cache.getOrRun("a", runLoader)
    const second = cache.getOrRun("a", runLoader)

    assert.equal(first, second, "same key must return the same cached promise")
    assert.equal(calls, 1)
})

test("evicts the least-recently-used entry once past maxEntries", () => {
    const cache = new LoaderCache({ maxEntries: 2 })
    cache.getOrRun("a", () => Promise.resolve("a"))
    cache.getOrRun("b", () => Promise.resolve("b"))
    cache.getOrRun("c", () => Promise.resolve("c")) // pushes "a" out

    assert.equal(cache.size, 2)
    assert.equal(cache.has("a"), false, "oldest entry should have been evicted")
    assert.equal(cache.has("b"), true)
    assert.equal(cache.has("c"), true)
})

test("a cache hit refreshes recency, so LRU eviction targets the true least-recently-used entry", () => {
    const cache = new LoaderCache({ maxEntries: 2 })
    cache.getOrRun("a", () => Promise.resolve("a"))
    cache.getOrRun("b", () => Promise.resolve("b"))
    cache.getOrRun("a", () => Promise.resolve("a-again")) // touch "a" — "b" is now the LRU entry
    cache.getOrRun("c", () => Promise.resolve("c")) // should push "b" out, not "a"

    assert.equal(cache.has("a"), true)
    assert.equal(cache.has("b"), false)
    assert.equal(cache.has("c"), true)
})

test("staleTime expiry treats an old entry as a miss and re-runs the loader", async () => {
    const cache = new LoaderCache()
    let calls = 0
    const runLoader = () => {
        calls++
        return Promise.resolve(calls)
    }

    cache.getOrRun("a", runLoader, { staleTime: -1 }) // already expired the instant it's set
    cache.getOrRun("a", runLoader, { staleTime: -1 })

    assert.equal(calls, 2, "an expired entry must not be served from cache")
})

test("getOrRunLoaderPromise (module-level singleton) does not cache outside a browser environment", () => {
    assert.equal(typeof window, "undefined", "this test must run in a non-browser environment to be meaningful")

    let calls = 0
    const runLoader = () => {
        calls++
        return Promise.resolve(calls)
    }

    getOrRunLoaderPromise("server-key", runLoader)
    getOrRunLoaderPromise("server-key", runLoader)

    assert.equal(calls, 2, "server-side callers must get a fresh call every time — no module-scope cache")
})
