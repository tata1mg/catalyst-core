import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { buildLoaderPromiseMap } from "../../../src/web-router/loader/buildLoaderPromiseMap.js"

test("critical-only route: the route's promise resolves to a fully-resolved value", async () => {
    const route = {
        path: "/breed/:breed",
        loader: async ({ params }) => ({ breed: params.breed }),
    }
    const map = buildLoaderPromiseMap([{ route, params: { breed: "labrador" } }])

    assert.deepEqual(Object.keys(map), ["/breed/:breed"])
    const result = await map["/breed/:breed"]
    assert.deepEqual(result, { breed: "labrador" })
})

test("deferred-only route: the route's own promise resolves immediately, its field stays pending", async () => {
    let deferredResolve
    const deferredPromise = new Promise((resolve) => {
        deferredResolve = resolve
    })
    const route = {
        path: "/related",
        loader: async () => ({ related: deferredPromise }), // not awaited — deliberately deferred
    }
    const map = buildLoaderPromiseMap([{ route, params: {} }])

    const result = await map["/related"]
    assert.equal(result.related, deferredPromise, "the field itself must still be the pending promise")

    let settled = false
    result.related.then(() => {
        settled = true
    })
    await Promise.resolve() // let microtasks flush
    assert.equal(settled, false, "must not have resolved yet")

    deferredResolve("now resolved")
    await result.related
})

test("mixed route: critical field is a value, deferred field stays a pending promise, in the same result", async () => {
    let releaseDeferred
    const deferred = new Promise((resolve) => {
        releaseDeferred = resolve
    })
    const route = {
        path: "/breed/:breed",
        loader: async ({ params }) => ({
            breed: { name: params.breed }, // critical (awaited nothing, already a value)
            related: deferred, // deferred (raw promise)
        }),
    }
    const map = buildLoaderPromiseMap([{ route, params: { breed: "poodle" } }])
    const result = await map["/breed/:breed"]

    assert.deepEqual(result.breed, { name: "poodle" })
    assert.equal(result.related, deferred)
    releaseDeferred("done")
})

test("pathless/index route with an explicit id uses that id as the map key", async () => {
    const route = {
        id: "home-index",
        loader: async () => ({ greeting: "hi" }),
    }
    const map = buildLoaderPromiseMap([{ route, params: {} }])

    assert.deepEqual(Object.keys(map), ["home-index"])
    assert.deepEqual(await map["home-index"], { greeting: "hi" })
})

test("a pathless/index route with a loader but no explicit id throws instead of silently colliding", () => {
    const route = { loader: async () => ({}) } // no path, no id
    assert.throws(
        () => buildLoaderPromiseMap([{ route, params: {} }]),
        /pathless\/index routes must set `id` explicitly/
    )
})

test("two matched routes resolving to the same id throw instead of silently discarding one", () => {
    const routeA = { id: "dup", loader: async () => ({}) }
    const routeB = { id: "dup", loader: async () => ({}) }
    assert.throws(
        () =>
            buildLoaderPromiseMap([
                { route: routeA, params: {} },
                { route: routeB, params: {} },
            ]),
        /resolved to the same id/
    )
})

test("routes without a loader are skipped entirely", () => {
    const route = { path: "/no-loader" }
    const map = buildLoaderPromiseMap([{ route, params: {} }])
    assert.deepEqual(map, {})
})

test("all loaders start in parallel, not one after another", async () => {
    const order = []
    const makeRoute = (path, delayMs) => ({
        path,
        loader: async () => {
            order.push(`start:${path}`)
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            order.push(`end:${path}`)
            return path
        },
    })

    const matches = [
        { route: makeRoute("/slow", 20), params: {} },
        { route: makeRoute("/fast", 0), params: {} },
    ]
    const map = buildLoaderPromiseMap(matches)
    await Promise.all(Object.values(map))

    // Both loaders must have STARTED before either FINISHED — proves they ran in
    // parallel rather than the second only starting once the first settled.
    assert.deepEqual(order.slice(0, 2).sort(), ["start:/fast", "start:/slow"])
})

test("a loader dispatching before the shell has started streaming does not warn", async () => {
    const warn = mock.method(console, "warn", () => {})
    try {
        const store = { dispatch: mock.fn((action) => action) }
        const shellStartedRef = { current: false }
        const route = {
            path: "/",
            loader: async ({ context }) => {
                context.store.dispatch({ type: "EARLY_ACTION" })
                return {}
            },
        }
        const map = buildLoaderPromiseMap([{ route, params: {} }], { store, shellStartedRef })
        await map["/"]

        assert.equal(store.dispatch.mock.callCount(), 1, "the dispatch must still go through")
        assert.equal(warn.mock.callCount(), 0)
    } finally {
        warn.mock.restore()
    }
})

test("a loader dispatching after the shell has started streaming warns but does not throw", async () => {
    const warn = mock.method(console, "warn", () => {})
    try {
        const store = { dispatch: mock.fn((action) => action) }
        const shellStartedRef = { current: true } // simulates onShellReady already having fired
        const route = {
            path: "/",
            loader: async ({ context }) => {
                context.store.dispatch({ type: "LATE_ACTION" })
                return { ok: true }
            },
        }
        const map = buildLoaderPromiseMap([{ route, params: {} }], { store, shellStartedRef })
        const result = await map["/"]

        assert.deepEqual(result, { ok: true }, "the loader must complete normally, not throw")
        assert.equal(store.dispatch.mock.callCount(), 1, "the dispatch must still go through")
        assert.equal(warn.mock.callCount(), 1)
        assert.match(warn.mock.calls[0].arguments[0], /LATE_ACTION/)
        assert.match(warn.mock.calls[0].arguments[0], /shell had already started streaming/)
    } finally {
        warn.mock.restore()
    }
})

test("a loader with no store in context (no configureStore in the app) works unaffected", async () => {
    const route = {
        path: "/",
        loader: async ({ context }) => ({ storeIsNull: context.store === null }),
    }
    const map = buildLoaderPromiseMap([{ route, params: {} }], { store: null, shellStartedRef: { current: true } })
    const result = await map["/"]
    assert.deepEqual(result, { storeIsNull: true })
})
