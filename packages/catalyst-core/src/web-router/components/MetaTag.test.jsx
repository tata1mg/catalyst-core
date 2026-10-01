import React from "react"
import { describe, expect, it, vi, afterEach } from "vitest"
import { render, waitFor, act } from "@testing-library/react"
import { MemoryRouter, Routes, Route, useNavigate } from "react-router"
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
    afterEach(() => {
        document.head.innerHTML = ""
    })

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
})
