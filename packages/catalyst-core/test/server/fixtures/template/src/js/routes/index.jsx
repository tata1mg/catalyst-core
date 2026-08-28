import React from "react"

// Fixture route table for the SSR handler tests (#348). Concrete routes
// plus a catch-all so tests can exercise the 200 / 404 / fetcher-error
// status branches in _handler and _renderMarkUp.

function HomePage() {
    return <p data-testid="home">home</p>
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

const routes = [
    { path: "/", component: HomePage },
    { path: "/fetcher-error", component: FetcherErrorLoadable },
    { path: "*", component: NotFoundPage },
]

export default routes
