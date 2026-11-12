import React, { Suspense } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { act, render, screen } from "@testing-library/react"
import {
    PPRDynamic,
    PPRHydrationBoundary,
    PPRRenderProvider,
    PPRRouteBoundary,
    useIsPPRShell,
    usePPRPhase,
} from "./PPR.jsx"

function PhaseReader() {
    return (
        <p data-testid="phase">
            {String(usePPRPhase())}|{String(useIsPPRShell())}
        </p>
    )
}

afterEach(() => {
    delete window.__CATALYST_PPR__
})

describe("usePPRPhase / useIsPPRShell", () => {
    it("is null / false outside a PPR render", () => {
        render(<PhaseReader />)
        expect(screen.getByTestId("phase")).toHaveTextContent("null|false")
    })

    it("reports the phase set by PPRRenderProvider", () => {
        render(
            <PPRRenderProvider value={{ phase: "prerender" }}>
                <PhaseReader />
            </PPRRenderProvider>
        )
        expect(screen.getByTestId("phase")).toHaveTextContent("prerender|true")
    })
})

describe("PPRDynamic", () => {
    it("renders its children inline outside a PPR render", () => {
        render(
            <PPRDynamic fallback={<p>fallback</p>}>
                <p>per request</p>
            </PPRDynamic>
        )
        expect(screen.getByText("per request")).toBeInTheDocument()
        expect(screen.queryByText("fallback")).toBeNull()
    })

    it("keeps its children out of the shell while prerendering", () => {
        render(
            <PPRRenderProvider value={{ phase: "prerender" }}>
                <PPRDynamic fallback={<p>fallback</p>}>
                    <p>per request</p>
                </PPRDynamic>
            </PPRRenderProvider>
        )
        expect(screen.getByText("fallback")).toBeInTheDocument()
        expect(screen.queryByText("per request")).toBeNull()
    })

    it("renders its children when the shell resumes", () => {
        render(
            <PPRRenderProvider value={{ phase: "resume" }}>
                <PPRDynamic fallback={<p>fallback</p>}>
                    <p>per request</p>
                </PPRDynamic>
            </PPRRenderProvider>
        )
        expect(screen.getByText("per request")).toBeInTheDocument()
    })
})

describe("PPRRouteBoundary", () => {
    it("shows the fallback while prerendering", () => {
        render(
            <PPRRenderProvider value={{ phase: "prerender", routeData: Promise.resolve({}) }}>
                <PPRRouteBoundary fallback={<p>skeleton</p>}>{() => <p>app</p>}</PPRRouteBoundary>
            </PPRRenderProvider>
        )
        expect(screen.getByText("skeleton")).toBeInTheDocument()
        expect(screen.queryByText("app")).toBeNull()
    })

    it("renders the app with the route data once it resolves", async () => {
        const routeData = Promise.resolve({ user: "a" })
        await act(async () => {
            render(
                <PPRRenderProvider value={{ phase: "resume", routeData }}>
                    <PPRRouteBoundary fallback={<p>skeleton</p>}>
                        {(data) => <p>app for {data.user}</p>}
                    </PPRRouteBoundary>
                </PPRRenderProvider>
            )
            await routeData
        })
        expect(await screen.findByText("app for a")).toBeInTheDocument()
    })
})

describe("PPRHydrationBoundary", () => {
    it("renders children as they are on a classic response", () => {
        const { container } = render(
            <PPRHydrationBoundary>
                <p>root</p>
            </PPRHydrationBoundary>
        )
        expect(container.innerHTML).toBe("<p>root</p>")
    })

    it("wraps children in a Suspense boundary on a PPR response", () => {
        window.__CATALYST_PPR__ = true
        const element = PPRHydrationBoundary({ children: <p>root</p> })
        expect(element.type).toBe(Suspense)
        render(element)
        expect(screen.getByText("root")).toBeInTheDocument()
    })
})
