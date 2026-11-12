import React from "react"
import { useCurrentRouteData } from "catalyst-core"
// From source, so the hook shares the PPR data context with the handler under test.
import { usePPRRouteData } from "../../../../../../../src/web-router/components/DataFetcher.jsx"

// Fixture route table for the SSR handler tests (#348). Concrete routes
// plus a catch-all so tests can exercise the 200 / 404 / fetcher-error
// status branches in _handler and _renderMarkUp.

function HomePage() {
    return <p data-testid="home">home</p>
}
// __cacheKey mirrors what Split.jsx stamps on split() components. The SSR
// handler *asset* tests (handler.assets.test.ts) mock manifestCache to
// return a manifest entry under this key, so preloadRouteCss resolves a
// real critical JS/CSS chunk for this route. Inert for handler.test.ts,
// which runs with empty manifests (no entry -> no assets).
HomePage.__cacheKey = "src/js/routes/HomePage"

// A route component that registers a deferred chunk during render the exact
// way Split.jsx does on the server (Split.jsx:53-54:
// `global.__CHUNK_EXTRACTOR__.addComponent(cacheKey)`). Split's own
// server-side behavior is unit-tested in Split.server.test.jsx (#454); this
// fixture exists so the *handler* asset tests can exercise what happens
// once a component has self-registered: getRenderedComponentKeys()
// serialization into window.__SSR_RENDERED_COMPONENTS__, the post-body
// deferred <style>/<script> flush, and the cross-request deferred-CSS
// cache. handler.assets.test.ts mocks manifestCache so WIDGET_CACHE_KEY
// resolves to a chunk with its own CSS.
export const WIDGET_CACHE_KEY = "src/js/components/Widget"

function WidgetPage() {
    if (typeof global !== "undefined" && global.__CHUNK_EXTRACTOR__) {
        global.__CHUNK_EXTRACTOR__.addComponent(WIDGET_CACHE_KEY)
    }
    return <p data-testid="widget">widget</p>
}

function NotFoundPage() {
    return <p data-testid="notfound">not found</p>
}

function FetcherErrorPage() {
    return <p data-testid="fetcher-error">boom page</p>
}

// serverDataFetcher only reads serverFetcher off a *loadable* component
// (`route.component.load()` -> module with a `default`). On the server
// (no window) fetchRouteData picks module.default.serverFetcher; when it
// rejects, serverDataFetcher records fetcherData[url].error, which
// _handler turns into an `err.status_code || 404` render.
const loadable = (mod) => {
    const C = mod.default
    C.load = () => Promise.resolve(mod)
    return C
}

const FetcherErrorLoadable = loadable({
    default: Object.assign(FetcherErrorPage, {
        serverFetcher: async () => {
            const e = new Error("fetcher exploded")
            e.status_code = 503
            throw e
        },
    }),
})

// A component that throws while rendering -- the most common dev-time
// failure. The handler must report it once and answer with a 500, not
// re-render it from every fallback and leave the request open.
function RenderErrorPage() {
    throw new Error("render exploded")
}

// Partial prerendering: the shell holds pprFallback; the page renders per request with its
// serverFetcher data (here, a value from the request's cookie, so the tests can check that one
// visitor's data never reaches the next one's response).
function PPRPage() {
    const { data } = useCurrentRouteData()
    if (data?.user === "throw-while-resuming") throw new Error("resume exploded")
    return <p data-testid="ppr-user">user:{data?.user}</p>
}
const PPRLoadable = loadable({
    default: Object.assign(PPRPage, {
        renderMode: "ppr",
        pprFallback: <p data-testid="ppr-skeleton">skeleton</p>,
        // ?late sets a cookie after the shell went out; ?slow delays the data.
        serverFetcher: async ({ req, res }) => {
            if (req.query?.slow !== undefined) await new Promise((resolve) => setTimeout(resolve, 100))
            if (req.query?.late !== undefined) res.cookie("late", "1")
            return { user: req.cookies?.user || "anonymous" }
        },
    }),
})

// PPR route whose serverFetcher fails: the status line is already out, so the code reaches
// the client as window.__STATUS_CODE__.
function PPRErrorPage() {
    return <p>ppr error page</p>
}
const PPRErrorLoadable = loadable({
    default: Object.assign(PPRErrorPage, {
        renderMode: "ppr",
        serverFetcher: async () => {
            const e = new Error("ppr fetcher exploded")
            e.status_code = 503
            throw e
        },
    }),
})

// PPR route that reads its data with usePPRRouteData instead of serverFetcher.
const fetchHookData = async () => ({ value: "hook data" })
function PPRHookPage() {
    const data = usePPRRouteData(fetchHookData)
    return <p data-testid="ppr-hook">{data.value}</p>
}
PPRHookPage.renderMode = "ppr"

function StaticErrorPage() {
    throw new Error("static render exploded")
}
StaticErrorPage.renderMode = "static"

// Static full-page cache: rendered once, replayed byte for byte.
let staticRenders = 0
export const getStaticRenders = () => staticRenders
function StaticPage() {
    staticRenders++
    return <p data-testid="static">static page</p>
}
StaticPage.renderMode = "static"

const routes = [
    { path: "/", component: HomePage },
    { path: "/ppr", component: PPRLoadable },
    { path: "/ppr-error", component: PPRErrorLoadable },
    { path: "/ppr-hook", component: PPRHookPage },
    { path: "/static-error", component: StaticErrorPage },
    { path: "/static", component: StaticPage },
    { path: "/render-error", component: RenderErrorPage },
    { path: "/widget", component: WidgetPage },
    { path: "/fetcher-error", component: FetcherErrorLoadable },
    { path: "*", component: NotFoundPage },
]

export default routes
