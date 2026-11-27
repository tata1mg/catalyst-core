import React from "react"
import { afterEach, describe, expect, it } from "vitest"
import { render, waitFor, act, cleanup } from "@testing-library/react"
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from "react-router"
import { MetaTag } from "./MetaTag.jsx"
import { OneMgRouterContext } from "../context.jsx"
import { RouterContext } from "./RouterDataProvider.jsx"
import { split } from "./Split.jsx"

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

    describe("title", () => {
        afterEach(() => {
            cleanup()
            document.head.innerHTML = ""
            document.title = ""
        })

        it("joins a title with several children without separators", async () => {
            const name = "Aspirin"
            const matchedRoutes = [
                { route: { component: { setMetaData: () => [<title key="t">{name} | 1mg</title>] } } },
            ]
            renderMetaTag({ matchedRoutes })

            await waitFor(() => expect(document.title).toBe("Aspirin | 1mg"))
        })

        it("ignores conditional children that render nothing", async () => {
            const matchedRoutes = [
                {
                    route: {
                        component: {
                            setMetaData: () => [
                                <title key="t">
                                    {false}Aspirin{null}
                                </title>,
                            ],
                        },
                    },
                },
            ]
            renderMetaTag({ matchedRoutes })

            await waitFor(() => expect(document.title).toBe("Aspirin"))
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

        it("keeps a single title and a single description across navigation", async () => {
            // Head.tsx renders only the title; MetaTag owns every other tag.
            document.head.innerHTML = '<title data-catalyst="true">Page a</title>'

            const { container } = render(
                <MemoryRouter initialEntries={["/a"]}>
                    <App />
                </MemoryRouter>
            )
            await waitFor(() => expect(document.title).toBe("Page a"))
            expect(document.querySelectorAll("title")).toHaveLength(1)
            expect(
                Array.from(document.querySelectorAll('meta[name="description"]'), (el) => el.content)
            ).toEqual(["about a"])

            await act(async () => {
                container.querySelector("button").click()
            })

            await waitFor(() => expect(document.title).toBe("Page b"))
            expect(document.querySelectorAll("title")).toHaveLength(1)
            expect(
                Array.from(document.querySelectorAll('meta[name="description"]'), (el) => el.content)
            ).toEqual(["about b"])
        })
    })

    // split() copies setMetaData onto the route component only when the chunk
    // loads, which nothing guarantees happens before MetaTag first renders.
    // MetaTag awaits load() itself and re-renders once it settles.
    describe("split() routes", () => {
        afterEach(() => {
            cleanup()
            document.head.innerHTML = ""
            document.title = ""
        })

        const deferred = () => {
            let resolve
            const promise = new Promise((r) => (resolve = r))
            return { promise, resolve }
        }
        const pageModule = (name) => {
            const Page = () => <p>{name}</p>
            Page.setMetaData = () => [
                <title key="t">{`Page ${name}`}</title>,
                <meta key="d" name="description" content={`about ${name}`} />,
            ]
            return { default: Page }
        }
        const serverTitle = (text) => {
            document.head.innerHTML = `<title data-catalyst="true">${text}</title>`
            return document.head.querySelector("title")
        }

        it("keeps the server-rendered title and adds no tags while the chunk is still loading", async () => {
            const serverEl = serverTitle("Page a")
            const chunk = deferred()
            const PageA = split(() => chunk.promise)

            renderMetaTag({ matchedRoutes: [{ route: { component: PageA } }] })
            await act(async () => {})

            expect(PageA.setMetaData).toBeUndefined()
            expect(serverEl.isConnected).toBe(true)
            expect(document.title).toBe("Page a")
            expect(document.head.querySelector('meta[name="description"]')).toBeNull()
        })

        it("renders the route's tags once its chunk loads after the first render", async () => {
            serverTitle("Stale title")
            const chunk = deferred()
            const PageA = split(() => chunk.promise)

            renderMetaTag({ matchedRoutes: [{ route: { component: PageA } }] })
            await act(async () => {
                chunk.resolve(pageModule("a"))
            })

            await waitFor(() => expect(document.title).toBe("Page a"))
            expect(document.querySelectorAll("title")).toHaveLength(1)
            expect(document.head.querySelector('meta[name="description"]').content).toBe("about a")
        })

        it("replaces the tags when navigating to a split route that has not loaded yet", async () => {
            const chunkB = deferred()
            const PageA = split(() => Promise.resolve(pageModule("a")))
            const PageB = split(() => chunkB.promise)

            function App() {
                const location = useLocation()
                const navigate = useNavigate()
                const component = location.pathname === "/a" ? PageA : PageB
                return (
                    <OneMgRouterContext.Provider value={{ matchedRoutes: [{ route: { component } }] }}>
                        <RouterContext.Provider value={{}}>
                            <button type="button" onClick={() => navigate("/b")}>
                                go
                            </button>
                            <MetaTag />
                        </RouterContext.Provider>
                    </OneMgRouterContext.Provider>
                )
            }

            const { container } = render(
                <MemoryRouter initialEntries={["/a"]}>
                    <App />
                </MemoryRouter>
            )
            await waitFor(() => expect(document.title).toBe("Page a"))

            await act(async () => {
                container.querySelector("button").click()
            })
            // Page a's title stays until page b's chunk arrives, rather than blanking.
            expect(document.title).toBe("Page a")

            await act(async () => {
                chunkB.resolve(pageModule("b"))
            })
            await waitFor(() => expect(document.title).toBe("Page b"))
            expect(document.querySelectorAll("title")).toHaveLength(1)
            expect(document.head.querySelector('meta[name="description"]').content).toBe("about b")
        })
    })
})
