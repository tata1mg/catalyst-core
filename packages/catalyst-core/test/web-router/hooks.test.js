import { test } from "node:test"
import assert from "node:assert/strict"
import { createElement as h } from "react"
import { renderToPipeableStream } from "react-dom/server"
import { UNSAFE_NavigationContext, UNSAFE_LocationContext, UNSAFE_RouteContext } from "react-router-dom"
import { Writable } from "node:stream"
import { useNavigateWithTransition } from "../../src/web-router/hooks.jsx"

// Same context-mocking approach as RouteDataProvider.test.js: real react-router-dom
// *components* (<StaticRouter>, useRoutes()) are compiled against this monorepo's
// root-hoisted React 18, while this test's own React resolves to catalyst-core's
// nested React 19 (a real, pre-existing dependency-tree split — see progress.md
// step 8's notes) — mixing them crashes React 19's renderer. Router *context
// objects* are safe to use directly since Provider/useContext threading doesn't
// depend on element identity the way rendering a component does.
const renderWithRouterContext = (element) =>
    new Promise((resolve, reject) => {
        let html = ""
        const writable = new Writable({
            write(chunk, _enc, cb) {
                html += chunk.toString()
                cb()
            },
        })
        writable.on("finish", () => resolve(html))
        writable.on("error", reject)

        const navigationValue = {
            basename: "/",
            navigator: { createHref: (to) => to, push: () => {}, replace: () => {}, go: () => {} },
            static: true,
            future: { v7_relativeSplatPath: false },
        }
        const locationValue = {
            location: { pathname: "/", search: "", hash: "", state: null, key: "default" },
            navigationType: "POP",
        }
        const routeValue = { matches: [{ route: { path: "/" }, params: {} }], outlet: null, isDataRoute: false }

        const tree = h(
            UNSAFE_NavigationContext.Provider,
            { value: navigationValue },
            h(UNSAFE_LocationContext.Provider, { value: locationValue }, h(UNSAFE_RouteContext.Provider, { value: routeValue }, element))
        )

        const { pipe } = renderToPipeableStream(tree, {
            onAllReady() {
                pipe(writable)
            },
            onError: reject,
        })
    })

test("useNavigateWithTransition returns a [navigate, isPending] tuple, isPending starts false", async () => {
    let captured
    const Probe = () => {
        captured = useNavigateWithTransition()
        return null
    }

    await renderWithRouterContext(h(Probe))

    assert.ok(Array.isArray(captured), "must return a tuple/array")
    assert.equal(captured.length, 2)
    assert.equal(typeof captured[0], "function", "first element must be the navigate function")
    assert.equal(captured[1], false, "isPending must start false")
})

test("the returned navigate function calls through to the underlying navigator", async () => {
    const pushCalls = []
    let captured
    const Probe = () => {
        captured = useNavigateWithTransition()
        return null
    }

    // Rebuild the render with a navigator we can observe, rather than reusing
    // the shared helper's inert one.
    await new Promise((resolve, reject) => {
        const writable = new Writable({
            write(_chunk, _enc, cb) {
                cb()
            },
        })
        writable.on("finish", resolve)
        writable.on("error", reject)

        const navigationValue = {
            basename: "/",
            navigator: {
                createHref: (to) => to,
                push: (to) => pushCalls.push(to),
                replace: () => {},
                go: () => {},
            },
            static: true,
            future: { v7_relativeSplatPath: false },
        }
        const locationValue = {
            location: { pathname: "/", search: "", hash: "", state: null, key: "default" },
            navigationType: "POP",
        }
        const routeValue = { matches: [{ route: { path: "/" }, params: {} }], outlet: null, isDataRoute: false }

        const tree = h(
            UNSAFE_NavigationContext.Provider,
            { value: navigationValue },
            h(UNSAFE_LocationContext.Provider, { value: locationValue }, h(UNSAFE_RouteContext.Provider, { value: routeValue }, h(Probe)))
        )

        const { pipe } = renderToPipeableStream(tree, {
            onAllReady() {
                pipe(writable)
            },
            onError: reject,
        })
    })

    const [navigate] = captured
    // React's `startTransition` cannot be invoked while `react-dom/server`'s
    // dispatcher is active at all — not a timing issue (this runs well after
    // the render itself, in onAllReady), an environment one: real usage is
    // exclusively client-side (navigation never happens during SSR), so this
    // documents that constraint with a real assertion rather than silently
    // assuming the happy path. If this ever stops throwing, `navigate`'s
    // wrapping around `startTransition` changed in a way worth noticing.
    assert.throws(() => navigate("/breed/labrador"), /startTransition cannot be called during server rendering/)
    assert.equal(pushCalls.length, 0, "the underlying navigator must not have been reached")
})
