import React from "react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, waitFor, act, cleanup } from "@testing-library/react"
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from "react-router"
import { MetaTag } from "./MetaTag.jsx"
import { OneMgRouterContext } from "../context.jsx"
import { RouterContext } from "./RouterDataProvider.jsx"

function renderMetaTag({ matchedRoutes = [], routerData = {} } = {}) {
    return render(
        <MemoryRouter initialEntries={["/"]}>
            <Routes>
                <Route
                    path="/"
                    element={
                        <OneMgRouterContext.Provider value={{ matchedRoutes }}>
                            <RouterContext.Provider value={routerData}>
                                <MetaTag />
                            </RouterContext.Provider>
                        </OneMgRouterContext.Provider>
                    }
                />
            </Routes>
        </MemoryRouter>
    )
}

describe("MetaTag", () => {
    it("renders without crashing when there are no matched routes", () => {
        expect(() => renderMetaTag()).not.toThrow()
    })

    it("writes tags returned by a matched route's setMetaData into the document head", async () => {
        const matchedRoutes = [
            {
                route: {
                    component: {
                        setMetaData: () => [<meta key="d" name="description" content="hello" />],
                    },
                },
            },
        ]
        renderMetaTag({ matchedRoutes })
        await waitFor(() => {
            expect(document.head.querySelector('meta[name="description"]')).not.toBeNull()
        })
        expect(document.head.querySelector('meta[name="description"]').getAttribute("content")).toBe("hello")
    })

    it("renders no metadata when no route provides setMetaData", () => {
        renderMetaTag({ matchedRoutes: [{ route: { component: {} } }] })
        expect(document.head.querySelector("[data-catalyst]")).toBeNull()
    })

    it("clears previous metadata when navigating to a route without setMetaData", async () => {
        const routeWithMetadata = [
            {
                route: {
                    component: {
                        setMetaData: () => [<meta key="d" name="description" content="with metadata" />],
                    },
                },
            },
        ]

        function RouteMetadata() {
            const location = useLocation()
            const matchedRoutes = location.pathname === "/with-metadata" ? routeWithMetadata : []

            return (
                <OneMgRouterContext.Provider value={{ matchedRoutes }}>
                    <RouterContext.Provider value={{}}>
                        <MetaTag />
                    </RouterContext.Provider>
                </OneMgRouterContext.Provider>
            )
        }

        function NavButton() {
            const navigate = useNavigate()
            return (
                <button type="button" onClick={() => navigate("/without-metadata")}>
                    go
                </button>
            )
        }

        render(
            <MemoryRouter initialEntries={["/with-metadata"]}>
                <NavButton />
                <RouteMetadata />
            </MemoryRouter>
        )

        await waitFor(() => {
            expect(document.head.querySelector('meta[name="description"]')).not.toBeNull()
        })

        await act(async () => {
            document.querySelector("button").click()
        })

        await waitFor(() => {
            expect(document.head.querySelector('meta[name="description"]')).toBeNull()
        })
    })

    describe("server-rendered head tags", () => {
        afterEach(() => {
            cleanup()
            document.head.innerHTML = ""
        })

        const pageMeta = (page) => [
            <title key="t">{`Page ${page}`}</title>,
            <meta key="d" name="description" content={`about ${page}`} />,
            <script key="ld" type="application/ld+json">{`{"page":"${page}"}`}</script>,
        ]
        const routesFor = (pathname) => [
            { route: { component: { setMetaData: () => pageMeta(pathname === "/a" ? "a" : "b") } } },
        ]

        function App() {
            const location = useLocation()
            const navigate = useNavigate()
            return (
                <OneMgRouterContext.Provider value={{ matchedRoutes: routesFor(location.pathname) }}>
                    <RouterContext.Provider value={{}}>
                        <button type="button" onClick={() => navigate("/b")}>
                            go
                        </button>
                        <MetaTag />
                    </RouterContext.Provider>
                </OneMgRouterContext.Provider>
            )
        }
        const tree = (
            <MemoryRouter initialEntries={["/a"]}>
                <App />
            </MemoryRouter>
        )

        it("hydrates without a mismatch and replaces the server's JSON-LD, title and meta on navigation", async () => {
            // What Head.tsx streams for /a: getMetaData output stamped data-catalyst.
            document.head.innerHTML = renderToString(<>{pageMeta("a")}</>).replace(
                /<(title|meta|script)/g,
                '<$1 data-catalyst="true"'
            )
            const container = document.createElement("div")
            container.innerHTML = renderToString(tree)
            document.body.appendChild(container)
            const onRecoverableError = vi.fn()

            await act(async () => {
                render(tree, { container, hydrate: true, onRecoverableError })
            })
            expect(onRecoverableError).not.toHaveBeenCalled()

            await act(async () => {
                container.querySelector("button").click()
            })

            await waitFor(() => {
                expect(document.title).toBe("Page b")
            })
            const jsonLd = document.querySelectorAll('script[type="application/ld+json"]')
            expect(Array.from(jsonLd, (el) => el.textContent)).toEqual(['{"page":"b"}'])
            expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull()
            expect(document.querySelectorAll("title")).toHaveLength(1)
            expect(
                Array.from(document.querySelectorAll('meta[name="description"]'), (el) => el.content)
            ).toEqual(["about b"])
        })
    })
})
