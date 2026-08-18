import { test } from "node:test"
import assert from "node:assert/strict"
import { Suspense, use, createElement as h } from "react"
import { renderToPipeableStream } from "react-dom/server"
import { UNSAFE_NavigationContext, UNSAFE_LocationContext, UNSAFE_RouteContext } from "react-router-dom"
import { Writable } from "node:stream"
import { RouteDataProvider, useRouteData } from "../../../src/web-router/loader/RouteDataProvider.jsx"

/**
 * No JSX here (plain `node --test` has no build step to transform it) and no
 * <StaticRouter>/useRoutes() either — this monorepo currently has a real,
 * pre-existing version split (root hoists react-router-dom's peer as React 18;
 * catalyst-core's own package.json pins React 19, so npm nests a separate
 * React 19 copy under packages/catalyst-core/node_modules). Invisible in the
 * actual app (Vite resolves "react" consistently for the whole bundle), but a
 * real problem for a bare `node --test`: any react-router-dom *component*
 * (StaticRouter, Routes/useRoutes) is compiled against react-router-dom's own
 * React 18, and React 19's renderer rejects the resulting elements
 * ("Objects are not valid as a React child"). Fixing that tree-wide split is
 * out of scope for this feature. Router *context objects* (not components) are
 * safe to use directly across the split — Provider/useContext threading relies
 * on each context object's own $$typeof (a global Symbol.for) and internal
 * value slot, not on a shared React module instance — so this builds the same
 * NavigationContext/LocationContext/RouteContext tree <Router>/useRoutes()
 * build internally (traced from react-router's own source), by hand, using
 * only React 19 (this test's own "react" resolution) to create every element.
 * That's still exercising RouteDataProvider's/useRouteData's real logic
 * (useLocation(), useContext(UNSAFE_RouteContext), the nearest-match/explicit-id
 * derivation) — only the routing-match machinery itself is stood in for.
 */
const renderToHtml = (element) =>
    new Promise((resolve, reject) => {
        let html = ""
        const writable = new Writable({
            write(chunk, _enc, callback) {
                html += chunk.toString()
                callback()
            },
        })
        writable.on("finish", () => resolve(html))
        writable.on("error", reject)

        const { pipe } = renderToPipeableStream(element, {
            onAllReady() {
                pipe(writable)
            },
            onError: reject,
        })
    })

/**
 * @param {{ pathname: string, matches: Array<{route: any, params: any}>, initialData?: any, store?: any, children: any }} args
 */
const renderAtRoute = ({ pathname, matches, initialData, store, children }) => {
    const navigationValue = {
        basename: "/",
        navigator: { createHref: (to) => to, push: () => {}, replace: () => {}, go: () => {} },
        static: true,
        future: { v7_relativeSplatPath: false },
    }
    const locationValue = {
        location: { pathname, search: "", hash: "", state: null, key: "default" },
        navigationType: "POP",
    }
    const routeValue = { matches, outlet: null }

    const tree = h(
        UNSAFE_NavigationContext.Provider,
        { value: navigationValue },
        h(
            UNSAFE_LocationContext.Provider,
            { value: locationValue },
            h(
                UNSAFE_RouteContext.Provider,
                { value: routeValue },
                h(RouteDataProvider, { initialData, store }, children)
            )
        )
    )
    return renderToHtml(tree)
}

test("useRouteData returns the nearest matched route's critical loader data", async () => {
    const Home = () => {
        const data = useRouteData()
        return h("div", null, data.greeting)
    }
    const route = { path: "/", loader: async () => ({ greeting: "hello" }) }
    const initialData = { "/": Promise.resolve({ greeting: "hello" }) }

    const html = await renderAtRoute({
        pathname: "/",
        matches: [{ route, params: {} }],
        initialData,
        children: h(Home),
    })
    assert.match(html, /hello/)
})

test("a route with no loader returns undefined without suspending", async () => {
    const Home = () => {
        const data = useRouteData()
        return h("div", null, data === undefined ? "no-data" : "unexpected")
    }
    const route = { path: "/" }

    const html = await renderAtRoute({
        pathname: "/",
        matches: [{ route, params: {} }],
        initialData: {},
        children: h(Home),
    })
    assert.match(html, /no-data/)
})

test("useRouteData(routeId) reads a specific ancestor route's data, not just the nearest", async () => {
    const Child = () => {
        const parentData = useRouteData("parent")
        return h("div", null, parentData.value)
    }
    const parentRoute = { id: "parent", path: "/parent", loader: async () => ({ value: "from-parent" }) }
    const childRoute = { path: "child" }
    const initialData = { parent: Promise.resolve({ value: "from-parent" }) }

    const html = await renderAtRoute({
        pathname: "/parent/child",
        matches: [
            { route: parentRoute, params: {} },
            { route: childRoute, params: {} },
        ],
        initialData,
        children: h(Child),
    })
    assert.match(html, /from-parent/)
})

test("a deferred field (raw, un-awaited promise) suspends and resolves within the same render", async () => {
    let releaseDeferred
    const deferred = new Promise((resolve) => {
        releaseDeferred = resolve
    })
    setTimeout(() => releaseDeferred({ related: "loaded-later" }), 5)

    const Related = ({ promise }) => {
        const related = use(promise)
        return h("span", null, related.related)
    }
    const Home = () => {
        const data = useRouteData()
        return h(
            "div",
            null,
            h("span", null, data.critical),
            h(Suspense, { fallback: h("span", null, "loading") }, h(Related, { promise: data.deferred }))
        )
    }
    const route = { path: "/" }
    const initialData = { "/": Promise.resolve({ critical: "now", deferred }) }

    const html = await renderAtRoute({
        pathname: "/",
        matches: [{ route, params: {} }],
        initialData,
        children: h(Home),
    })
    assert.match(html, /now/)
    assert.match(html, /loaded-later/)
})
