import { test } from "node:test"
import assert from "node:assert/strict"
import { LoaderCache, getOrRunLoaderPromise, abortLoaderPromise } from "../../../src/web-router/loader/loaderCache.js"

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

test("dedup: two concurrent calls for the same key, before either settles, share one in-flight promise", async () => {
    const cache = new LoaderCache()
    let calls = 0
    let releaseFirst
    const runLoader = () => {
        calls++
        return new Promise((resolve) => {
            releaseFirst = resolve
        })
    }

    const first = cache.getOrRun("a", runLoader)
    const second = cache.getOrRun("a", runLoader) // arrives before `first` has settled

    assert.equal(calls, 1, "the loader must run exactly once for two concurrent requests of the same key")
    assert.equal(first, second, "both callers must get the exact same promise")

    releaseFirst("done")
    assert.equal(await first, "done")
    assert.equal(await second, "done")
})

test("getOrRun passes an AbortSignal to the loader", () => {
    const cache = new LoaderCache()
    let receivedSignal
    cache.getOrRun("a", (signal) => {
        receivedSignal = signal
        return Promise.resolve()
    })

    assert.ok(receivedSignal instanceof AbortSignal)
    assert.equal(receivedSignal.aborted, false)
})

test("abort() aborts the in-flight loader's signal and evicts the entry", () => {
    const cache = new LoaderCache()
    let receivedSignal
    cache.getOrRun("a", (signal) => {
        receivedSignal = signal
        return new Promise(() => {}) // never settles, matching a real aborted fetch
    })

    assert.equal(cache.has("a"), true)
    cache.abort("a")

    assert.equal(receivedSignal.aborted, true)
    assert.equal(cache.has("a"), false, "an aborted entry must not be served to a later caller")
})

test("abort() on a key with no entry is a safe no-op", () => {
    const cache = new LoaderCache()
    assert.doesNotThrow(() => cache.abort("never-requested"))
})

test("a key re-requested after being aborted runs the loader fresh", () => {
    const cache = new LoaderCache()
    let calls = 0
    const runLoader = () => {
        calls++
        return new Promise(() => {})
    }

    cache.getOrRun("a", runLoader)
    cache.abort("a")
    cache.getOrRun("a", runLoader)

    assert.equal(calls, 2)
})

test("abortLoaderPromise (module-level) is a safe no-op outside a browser environment", () => {
    assert.equal(typeof window, "undefined", "this test must run in a non-browser environment to be meaningful")
    assert.doesNotThrow(() => abortLoaderPromise("any-key"))
})
