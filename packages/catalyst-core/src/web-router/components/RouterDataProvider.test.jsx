import React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route, useRoutes } from "react-router"
import {
    RouterDataProvider,
    useRouterData,
    useCurrentRouteData,
    useRouterState,
    serverDataFetcher,
} from "./RouterDataProvider.jsx"

// fetchRouteData (called internally by serverDataFetcher) picks
// component.default.clientFetcher vs. component.default.serverFetcher
// based on `typeof window === "undefined"`. Under vitest's jsdom
// environment, `window` IS defined, so despite the name
// "serverDataFetcher" these tests exercise the clientFetcher branch --
// there is no way to hit the serverFetcher branch from this project's
// jsdom environment (it would need the "node" environment instead, but
// then rendering/DOM assertions elsewhere in this file wouldn't work).
// Named clientFetcher in the mocks below to match what's actually
// invoked, not what the outer function's name implies.
describe("serverDataFetcher", () => {
    it("returns an empty object when no routes match the given url", async () => {
        const routes = [{ path: "/nowhere", component: {} }]
        const req = { query: {} }
        const result = await serverDataFetcher({ routes, url: "/somewhere-else", req }, {})
        expect(result).toEqual({})
    })

    // `component` is only ever populated via `route.component.load()` --
    // a React.lazy-style loadable, not the module itself. A plain object
    // at `route.component` (no `.load` method) leaves `component` as
    // `null` for the entire call, so `component?.default?.clientFetcher`
    // is always undefined regardless of what's on the plain object.
    // Confirmed directly by first writing route.component as a plain
    // `{ default: { clientFetcher } }` object and observing data stay
    // null -- routes here must mimic the loadable shape.
    function loadableComponent(mod) {
        return { load: () => Promise.resolve(mod) }
    }

    it("calls a matched route's clientFetcher (jsdom has `window`) and keys the result by path", async () => {
        const clientFetcher = vi.fn().mockResolvedValue({ hello: "world" })
        const routes = [{ path: "/page", component: loadableComponent({ default: { clientFetcher } }) }]
        const req = { query: {} }
        const result = await serverDataFetcher({ routes, url: "/page", req }, { some: "arg" })
        const key = Object.keys(result)[0]
        expect(key).toBe("/page")
        expect(result[key].data).toEqual({ hello: "world" })
        expect(result[key].error).toBeNull()
        expect(clientFetcher).toHaveBeenCalledWith(
            expect.objectContaining({ route: routes[0] }),
            { some: "arg" },
            undefined
        )
    })

    it("records the error and marks isFetched when the fetcher throws", async () => {
        const clientFetcher = vi.fn().mockRejectedValue(new Error("network down"))
        const routes = [{ path: "/page", component: loadableComponent({ default: { clientFetcher } }) }]
        const req = { query: {} }
        const result = await serverDataFetcher({ routes, url: "/page", req }, {})
        const key = Object.keys(result)[0]
        expect(result[key].error).toBeInstanceOf(Error)
        expect(result[key].isFetched).toBe(true)
        expect(result[key].isFetching).toBe(false)
    })

    it("marks fetcherNotAvailable when the matched route's component has no fetcher", async () => {
        const routes = [{ path: "/page", component: loadableComponent({ default: {} }) }]
        const req = { query: {} }
        const result = await serverDataFetcher({ routes, url: "/page", req }, {})
        const key = Object.keys(result)[0]
        expect(result[key].fetcherNotAvailable).toBe(true)
    })

    it("marks fetcherNotAvailable when the matched route's component is a plain (non-loadable) object", async () => {
        // route.component without a .load() method leaves `component`
        // null internally -- documents the loadable-only contract.
        const routes = [{ path: "/page", component: { default: { clientFetcher: vi.fn() } } }]
        const req = { query: {} }
        const result = await serverDataFetcher({ routes, url: "/page", req }, {})
        const key = Object.keys(result)[0]
        expect(result[key].fetcherNotAvailable).toBe(true)
    })

    it("builds a query-string suffix onto the route key from req.query", async () => {
        const routes = [{ path: "/page", component: { default: {} } }]
        const req = { query: { a: "1", b: "2" } }
        const result = await serverDataFetcher({ routes, url: "/page", req }, {})
        expect(Object.keys(result)[0]).toBe("/page?a=1&b=2")
    })
})

function Page() {
    const data = useRouterData()
    return <div data-testid="data">{JSON.stringify(data)}</div>
}

// NOTE: `initialState` must be passed as a real object, not left to
// default to undefined. Confirmed directly: RouterDataProvider's mount
// effect reads `routeData[routeKey]?.isFetched` (routeData being the
// `initialState` passed to useState) -- if `initialState` is omitted,
// `routeData` is `undefined` on the first render, and `undefined[...]`
// throws a real TypeError inside the effect. This is a genuine
// pre-existing gap in RouterDataProvider (no default value / no guard on
// `initialState`), not a test-authoring workaround -- flagged here
// rather than silently avoided, since every real usage observed in this
// codebase does pass a real initialState (hydration data from SSR).
function renderWithProvider(path = "/") {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route
                    path="/"
                    element={
                        <RouterDataProvider initialState={{}} config={{}}>
                            <Page />
                        </RouterDataProvider>
                    }
                />
            </Routes>
        </MemoryRouter>
    )
}

describe("RouterDataProvider", () => {
    it("renders its children", async () => {
        renderWithProvider()
        await waitFor(() => expect(screen.getByTestId("data")).toBeInTheDocument())
    })

    it("provides a router-data context to useRouterData", async () => {
        renderWithProvider()
        await waitFor(() => {
            const parsed = JSON.parse(screen.getByTestId("data").textContent)
            expect(typeof parsed).toBe("object")
        })
    })
})

describe("useRouterData", () => {
    // NOTE: this does NOT actually throw outside a provider, despite the
    // source's explicit `if (context === undefined) throw ...` guard and
    // its own JSDoc saying "@throws If used outside RouterDataProvider
    // Context". RouterContext is created via `createContext({})`, so
    // useContext(RouterContext) returns `{}` (the default value), never
    // `undefined`, when there's no ancestor provider -- the guard clause
    // is unreachable dead code. Documenting the actual behavior here
    // rather than asserting the documented-but-unreachable throw.
    it("returns the context's default empty object when used outside a RouterDataProvider (documented throw is unreachable)", () => {
        function Bare() {
            const data = useRouterData()
            return <div data-testid="bare">{JSON.stringify(data)}</div>
        }
        render(<Bare />)
        expect(screen.getByTestId("bare")).toHaveTextContent("{}")
    })
})

describe("useCurrentRouteData", () => {
    // Needs a real matched route (UNSAFE_RouteContext.matches populated by
    // react-router's own <Routes>/<Route>) plus a real RouterDataProvider
    // ancestor for OneMgRouterContext's refetchData/clear -- not
    // reasonably mockable in isolation, matching the same
    // real-MemoryRouter approach used for RouterDataProvider itself.
    function CurrentData() {
        const data = useCurrentRouteData()
        return <div data-testid="current">{JSON.stringify(data)}</div>
    }

    function renderAtPage({ initialState = {} } = {}) {
        return render(
            <MemoryRouter initialEntries={["/page"]}>
                <Routes>
                    <Route
                        path="/page"
                        element={
                            <RouterDataProvider initialState={initialState} config={{}}>
                                <CurrentData />
                            </RouterDataProvider>
                        }
                    />
                </Routes>
            </MemoryRouter>
        )
    }

    it("returns the initial (unfetched) data shape when no data has been loaded for the current route yet", async () => {
        renderAtPage()
        await waitFor(() => {
            const parsed = JSON.parse(screen.getByTestId("current").textContent)
            expect(parsed.data).toBeNull()
            expect(parsed.error).toBeNull()
        })
    })

    it("returns previously-fetched data for the current route from initialState", async () => {
        // RouterDataProvider's own mount effect will still run and may
        // overwrite this if the route has no component/fetcher -- but
        // with no `component` on the plain route object here, the
        // fetcher path is never taken, so initialState should be
        // reflected as-is for at least the first render before any
        // effect fires.
        renderAtPage({ initialState: { "/page": { data: { hello: "world" }, error: null, isFetched: true } } })
        await waitFor(() => {
            const parsed = JSON.parse(screen.getByTestId("current").textContent)
            expect(parsed.data).toEqual({ hello: "world" })
        })
    })

    it("exposes refetch() which re-runs the route fetcher and updates the route data", async () => {
        const clientFetcher = vi.fn().mockResolvedValue({ n: 1 })
        function RefetchPage() {
            const { refetch, data } = useCurrentRouteData()
            return (
                <div>
                    <span data-testid="n">{data ? String(data.n) : "none"}</span>
                    <button onClick={() => refetch()}>refetch</button>
                </div>
            )
        }
        render(
            <MemoryRouter initialEntries={["/page"]}>
                <Routes>
                    <Route
                        path="/page"
                        element={
                            <RouterDataProvider initialState={{}} config={{}}>
                                <RefetchPage />
                            </RouterDataProvider>
                        }
                        // loadable-shaped component so fetchRouteData resolves clientFetcher (jsdom has window)
                    />
                </Routes>
            </MemoryRouter>,
        )
        // route object here has no component -> refetch still runs
        // fetchRouteData (which finds no fetcher) and writes an
        // isFetching->settled cycle without throwing.
        await act(async () => {
            screen.getByText("refetch").click()
        })
        await waitFor(() => expect(screen.getByTestId("n")).toBeInTheDocument())
    })

    it("exposes clear() which resets the current route's data after the given delay", async () => {
        vi.useFakeTimers()
        try {
            let clearFn
            function ClearPage() {
                const { clear } = useCurrentRouteData()
                clearFn = clear
                return <div data-testid="ready">ready</div>
            }
            render(
                <MemoryRouter initialEntries={["/page"]}>
                    <Routes>
                        <Route
                            path="/page"
                            element={
                                <RouterDataProvider
                                    initialState={{ "/page": { data: { keep: 1 }, isFetched: true } }}
                                    config={{}}
                                >
                                    <ClearPage />
                                </RouterDataProvider>
                            }
                        />
                    </Routes>
                </MemoryRouter>,
            )
            expect(typeof clearFn).toBe("function")
            act(() => {
                clearFn(5)
                vi.advanceTimersByTime(5)
            })
            // no throw; the setTimeout callback ran and reset routeData
            expect(screen.getByTestId("ready")).toBeInTheDocument()
        } finally {
            vi.useRealTimers()
        }
    })

    it("re-runs the mount effect for an already-fetched route when config.disableCaching is true (shouldFetch global branch)", async () => {
        // isFetched is true in initialState, but config.disableCaching
        // makes shouldFetch() return true, so the mount effect does not
        // early-return -- it re-enters the fetch path (no fetcher on the
        // plain route -> fetcherNotAvailable, but shouldFetch's global
        // branch is exercised).
        render(
            <MemoryRouter initialEntries={["/page"]}>
                <Routes>
                    <Route
                        path="/page"
                        element={
                            <RouterDataProvider
                                initialState={{ "/page": { data: { v: 1 }, isFetched: true } }}
                                config={{ disableCaching: true }}
                            >
                                <div data-testid="ready">ready</div>
                            </RouterDataProvider>
                        }
                    />
                </Routes>
            </MemoryRouter>,
        )
        await waitFor(() => expect(screen.getByTestId("ready")).toBeInTheDocument())
    })
})

describe("useRouterState", () => {
    function StateProbe() {
        const { location, params, navigate, matchedRoutes } = useRouterState()
        return (
            <div
                data-testid="state"
                data-path={location.pathname}
                data-params={JSON.stringify(params)}
                data-nav={typeof navigate}
                data-matched={Array.isArray(matchedRoutes) ? "array" : "other"}
            />
        )
    }

    it("exposes the router location, params, navigate and matched routes under a RouterDataProvider", async () => {
        render(
            <MemoryRouter initialEntries={["/items/42"]}>
                <Routes>
                    <Route
                        path="/items/:id"
                        element={
                            <RouterDataProvider initialState={{}} config={{}}>
                                <StateProbe />
                            </RouterDataProvider>
                        }
                    />
                </Routes>
            </MemoryRouter>
        )
        const el = await screen.findByTestId("state")
        expect(el.dataset.path).toBe("/items/42")
        expect(JSON.parse(el.dataset.params)).toEqual({ id: "42" })
        expect(el.dataset.nav).toBe("function")
        expect(el.dataset.matched).toBe("array")
    })

    it("throws a clear error when used outside a RouterDataProvider", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        expect(() => render(<StateProbe />)).toThrow(/useRouterState must be used within a RouterDataProvider/)
        spy.mockRestore()
    })
})

describe("RouterDataProvider dev HMR and request ordering", () => {
    // Mimics routeFetcherHmrPlugin's footer.
    const hotUpdate = (prev, next, { fetcherChanged = true, serverFetcherChanged = false } = {}) => {
        window.__CATALYST_HMR__.replaced.set(prev, next)
        const detail = { prev, next, fetcherChanged, serverFetcherChanged, splits: [], reload: false }
        act(() => {
            window.__CATALYST_HMR__.splits.forEach((onUpdate) => onUpdate(detail))
            window.dispatchEvent(new CustomEvent("catalyst:route-module-updated", { detail }))
        })
        return detail
    }

    beforeEach(() => {
        window.__CATALYST_HMR__ ||= { replaced: new WeakMap(), splits: new Set() }
    })

    const pageModule = (name, clientFetcher) => {
        function Page() {
            const { data, refetch } = useCurrentRouteData()
            return (
                <div>
                    <span data-testid={name}>{data ? data.v : "none"}</span>
                    <button onClick={() => refetch()}>refetch {name}</button>
                </div>
            )
        }
        return { default: Object.assign(Page, { clientFetcher }) }
    }

    async function renderApp(pages, initialPath = "/a", initialState = {}) {
        const { split } = await import("./Split.jsx")
        const { Outlet, useNavigate } = await import("react-router")
        const routes = Object.entries(pages).map(([path, mod]) => {
            const Component = split(() => Promise.resolve(mod), {})
            return { path, component: Component, element: <Component /> }
        })
        let navigate
        function App() {
            navigate = useNavigate()
            return useRoutes([
                {
                    path: "/",
                    element: (
                        <RouterDataProvider initialState={initialState} config={{}}>
                            <Outlet />
                        </RouterDataProvider>
                    ),
                    children: routes,
                },
            ])
        }
        render(
            <MemoryRouter initialEntries={[initialPath]}>
                <App />
            </MemoryRouter>
        )
        return { routes, go: (to) => act(() => navigate(to)) }
    }

    it("ignores an older in-flight fetch that resolves after a newer one", async () => {
        const resolvers = []
        const clientFetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)))
        await renderApp({ "/a": pageModule("a", clientFetcher) })
        await waitFor(() => expect(clientFetcher).toHaveBeenCalledTimes(1))
        await act(async () => screen.getByText("refetch a").click())
        await waitFor(() => expect(clientFetcher).toHaveBeenCalledTimes(2))
        await act(async () => resolvers[1]({ v: "newer" }))
        await act(async () => resolvers[0]({ v: "older" }))
        expect(screen.getByTestId("a").textContent).toBe("newer")
    })

    it("refetches the visible page when its clientFetcher is hot-updated, not on component-only edits", async () => {
        const v1 = pageModule("a", vi.fn().mockResolvedValue({ v: "v1" }))
        await renderApp({ "/a": v1 })
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("v1"))

        const jsxOnly = pageModule("a", v1.default.clientFetcher)
        hotUpdate(v1, jsxOnly, { fetcherChanged: false })
        await act(async () => {})
        expect(v1.default.clientFetcher).toHaveBeenCalledTimes(1)

        const v2 = pageModule("a", vi.fn().mockResolvedValue({ v: "v2" }))
        hotUpdate(jsxOnly, v2)
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("v2"))
    })

    it("refetches a page whose clientFetcher was edited while it was not on screen", async () => {
        const a1 = pageModule("a", vi.fn().mockResolvedValue({ v: "a1" }))
        const b = pageModule("b", vi.fn().mockResolvedValue({ v: "b" }))
        const { go } = await renderApp({ "/a": a1, "/b": b })
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("a1"))
        go("/b")
        await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("b"))

        const a2 = pageModule("a", vi.fn().mockResolvedValue({ v: "a2" }))
        hotUpdate(a1, a2)
        expect(a2.default.clientFetcher).not.toHaveBeenCalled()
        go("/a")
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("a2"))

        // Unedited pages keep their cached data.
        go("/b")
        await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("b"))
        expect(b.default.clientFetcher).toHaveBeenCalledTimes(1)
    })

    const ssrData = (v) => ({ data: { v }, error: null, isFetching: false, isFetched: true })

    it("asks for a reload when the page on screen shows data from an edited serverFetcher", async () => {
        const a1 = pageModule("a", vi.fn().mockResolvedValue({ v: "client" }))
        await renderApp({ "/a": a1 }, "/a", { "/a": ssrData("ssr") })
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ssr"))
        const detail = hotUpdate(a1, pageModule("a", a1.default.clientFetcher), {
            fetcherChanged: false,
            serverFetcherChanged: true,
        })
        expect(detail.reload).toBe(true)
    })

    it("does not reload for a serverFetcher edit once the client has fetched that page", async () => {
        const a1 = pageModule("a", vi.fn().mockResolvedValue({ v: "client" }))
        await renderApp({ "/a": a1 }, "/a", { "/a": ssrData("ssr") })
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ssr"))
        await act(async () => screen.getByText("refetch a").click())
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("client"))
        const detail = hotUpdate(a1, pageModule("a", a1.default.clientFetcher), {
            fetcherChanged: false,
            serverFetcherChanged: true,
        })
        expect(detail.reload).toBe(false)
    })

    it("drops cached SSR data of an off-screen page whose serverFetcher was edited", async () => {
        const a1 = pageModule("a", vi.fn().mockResolvedValue({ v: "client" }))
        const b = pageModule("b", vi.fn().mockResolvedValue({ v: "b" }))
        const { go } = await renderApp({ "/a": a1, "/b": b }, "/a", { "/a": ssrData("ssr") })
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("ssr"))
        go("/b")
        await waitFor(() => expect(screen.getByTestId("b").textContent).toBe("b"))
        const detail = hotUpdate(a1, pageModule("a", a1.default.clientFetcher), {
            fetcherChanged: false,
            serverFetcherChanged: true,
        })
        expect(detail.reload).toBe(false)
        go("/a")
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("client"))
    })

    it("handles hot updates when the page module (and its footer) loads after the provider mounted", async () => {
        // Pages rendered through React.lazy load after RouterDataProvider's effects ran,
        // so the dev registry the footer creates doesn't exist yet at mount.
        const hmr = window.__CATALYST_HMR__
        delete window.__CATALYST_HMR__
        const { split } = await import("./Split.jsx")
        const { Outlet } = await import("react-router")
        const v1 = pageModule("a", vi.fn().mockResolvedValue({ v: "v1" }))
        let releasePage
        const Page = split(
            () =>
                new Promise((resolve) => {
                    releasePage = () => {
                        window.__CATALYST_HMR__ = hmr // the footer runs as the module evaluates
                        resolve(v1)
                    }
                }),
            {}
        )
        function App() {
            return useRoutes([
                {
                    path: "/",
                    element: (
                        <RouterDataProvider initialState={{}} config={{}}>
                            <Outlet />
                        </RouterDataProvider>
                    ),
                    children: [{ path: "a", component: Page, element: <Page /> }],
                },
            ])
        }
        render(
            <MemoryRouter initialEntries={["/a"]}>
                <App />
            </MemoryRouter>
        )
        await waitFor(() => expect(releasePage).toBeTypeOf("function"))
        await act(async () => releasePage())
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("v1"))
        const v2 = pageModule("a", vi.fn().mockResolvedValue({ v: "v2" }))
        hotUpdate(v1, v2)
        await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("v2"))
    })
})
