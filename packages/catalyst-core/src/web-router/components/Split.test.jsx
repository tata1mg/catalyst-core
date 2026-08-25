import React, { Suspense } from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import Split, { split } from "./Split.jsx"
import { SsrRequestProvider } from "./SsrRequestContext.jsx"

// jsdom does not implement IntersectionObserver; SplitInview (used by the
// client, non-skipVisibility path) needs one. Stub it to fire visible
// immediately so tests default to "already visible" unless a test wants
// to hold back visibility deliberately.
class ImmediateIntersectionObserver {
    constructor(callback) {
        this.callback = callback
    }
    observe(node) {
        // Fire on next tick so React has committed the ref first.
        Promise.resolve().then(() => this.callback([{ target: node, isIntersecting: true }]))
    }
    unobserve() {}
    disconnect() {}
}

beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe("Split (client-side, window defined)", () => {
    it("renders children directly when skipVisibility is true", () => {
        render(
            <Split skipVisibility fallback={<span>loading</span>}>
                <span>content</span>
            </Split>
        )
        expect(screen.getByText("content")).toBeInTheDocument()
    })

    it("defers to SplitInview (shows fallback first) when skipVisibility is false", () => {
        render(
            <Split fallback={<span>loading</span>}>
                <span>content</span>
            </Split>
        )
        // Before the stubbed IntersectionObserver's microtask fires,
        // SplitInview should still be showing the fallback.
        expect(screen.getByText("loading")).toBeInTheDocument()
    })

    it("eventually renders children once SplitInview reports visibility", async () => {
        render(
            <Split fallback={<span>loading</span>}>
                <span>content</span>
            </Split>
        )
        await waitFor(() => expect(screen.getByText("content")).toBeInTheDocument())
    })
})

describe("split()", () => {
    it("returns a component (wrapper) rather than throwing, given a lazy-style import function", () => {
        const importFn = () => Promise.resolve({ default: () => <span>lazy content</span> })
        const LazyThing = split(importFn, { ssr: false })
        expect(typeof LazyThing).toBe("function")
        expect(typeof LazyThing.load).toBe("function")
    })

    it("eventually renders the resolved component's output", async () => {
        const importFn = () => Promise.resolve({ default: () => <span>lazy content</span> })
        const LazyThing = split(importFn, { ssr: false, fallback: <span>loading</span> })
        render(<LazyThing skipVisibility />)
        await waitFor(() => expect(screen.getByText("lazy content")).toBeInTheDocument())
    })

    it("copies clientFetcher/serverFetcher/setMetaData from the resolved module onto the wrapper via load()", async () => {
        const clientFetcher = vi.fn()
        const serverFetcher = vi.fn()
        const setMetaData = vi.fn()
        const importFn = () =>
            Promise.resolve({
                default: Object.assign(() => <span>x</span>, { clientFetcher, serverFetcher, setMetaData }),
            })
        const LazyThing = split(importFn, {})
        await LazyThing.load()
        expect(LazyThing.clientFetcher).toBe(clientFetcher)
        expect(LazyThing.serverFetcher).toBe(serverFetcher)
        expect(LazyThing.setMetaData).toBe(setMetaData)
    })

    it("load() only calls the import function once even when called multiple times concurrently", async () => {
        const importFn = vi.fn().mockResolvedValue({ default: () => <span>x</span> })
        const LazyThing = split(importFn, {})
        const [a, b] = await Promise.all([LazyThing.load(), LazyThing.load()])
        expect(importFn).toHaveBeenCalledTimes(1)
        expect(a).toBe(b)
    })

    it("load() caches its result -- a second call after resolution reuses the cached module without re-importing", async () => {
        const importFn = vi.fn().mockResolvedValue({ default: () => <span>x</span> })
        const LazyThing = split(importFn, {})
        await LazyThing.load()
        await LazyThing.load()
        expect(importFn).toHaveBeenCalledTimes(1)
    })

    it("treats a bot request (via SsrRequestContext) as forcing effectiveSsr, skipping visibility gating", async () => {
        const importFn = () => Promise.resolve({ default: () => <span>bot content</span> })
        const LazyThing = split(importFn, { ssr: false })
        render(
            <SsrRequestProvider value={{ isBot: true }}>
                <LazyThing />
            </SsrRequestProvider>
        )
        // effectiveSsr = ssr || isBot = false || true = true, so Split's
        // `!isServer` branch takes skipVisibility={effectiveSsr || anyVisible}
        // = true -- content should render without waiting on an
        // IntersectionObserver callback at all.
        await waitFor(() => expect(screen.getByText("bot content")).toBeInTheDocument())
    })
})
