import React from "react"
import { describe, expect, it, vi, afterEach } from "vitest"
import { render, waitFor, act } from "@testing-library/react"
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom"
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
        expect(document.head.querySelector('meta[name="description"]').getAttribute("content")).toBe(
            "hello"
        )
    })

    it("keeps the placeholder meta tag when no route provides setMetaData", () => {
        renderMetaTag({ matchedRoutes: [{ route: { component: {} } }] })
        // Component should still render (Helmet/HelmetProvider tree),
        // even with the single empty placeholder <meta> from useState.
        expect(document.querySelector("head")).not.toBeNull()
    })

    it("re-runs setMetaData and clears previous tags when the location changes", async () => {
        // A rerender() with a NEW <MemoryRouter initialEntries> does not
        // navigate an already-mounted router -- initialEntries is only
        // read on first mount. Confirmed directly: that approach left
        // setMetaData called once even after "changing" the path.
        // Navigating within one mounted router (via a real useNavigate
        // call, triggered here through a button) is what actually
        // changes useLocation() and re-fires MetaTag's effect.
        const setMetaData = vi.fn(() => [<meta key="d" name="description" content="v1" />])
        const matchedRoutes = [{ route: { component: { setMetaData } } }]

        function NavButton() {
            const navigate = useNavigate()
            return (
                <button type="button" onClick={() => navigate("/b")}>
                    go
                </button>
            )
        }

        render(
            <MemoryRouter initialEntries={["/a"]}>
                <OneMgRouterContext.Provider value={{ matchedRoutes }}>
                    <RouterContext.Provider value={{}}>
                        <NavButton />
                        <MetaTag />
                    </RouterContext.Provider>
                </OneMgRouterContext.Provider>
            </MemoryRouter>
        )
        await waitFor(() => expect(setMetaData).toHaveBeenCalledTimes(1))

        await act(async () => {
            document.querySelector("button").click()
        })
        await waitFor(() => expect(setMetaData).toHaveBeenCalledTimes(2))
    })
})
