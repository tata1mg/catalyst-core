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

    it("load() clears the in-flight promise and rethrows when the import rejects", async () => {
        const importFn = vi.fn().mockRejectedValue(new Error("chunk 404"))
        const LazyThing = split(importFn, {})
        await expect(LazyThing.load()).rejects.toThrow("chunk 404")
        // in-flight was cleared -> a retry re-imports rather than
        // returning the settled rejection.
        importFn.mockResolvedValueOnce({ default: () => <span>recovered</span> })
        await expect(LazyThing.load()).resolves.toBeTruthy()
        expect(importFn).toHaveBeenCalledTimes(2)
    })

    it("copies clientFetcher / serverFetcher / setMetaData statics onto the wrapper after load()", async () => {
        const clientFetcher = () => {}
        const setMetaData = () => {}
        const importFn = vi
            .fn()
            .mockResolvedValue({ default: Object.assign(() => <span>c</span>, { clientFetcher, setMetaData }) })
        const LazyThing = split(importFn, {})
        await LazyThing.load()
        expect(LazyThing.clientFetcher).toBe(clientFetcher)
        expect(LazyThing.setMetaData).toBe(setMetaData)
    })

    it("renders straight from the module cache (no Split/observer) once load() has resolved", async () => {
        const importFn = vi.fn().mockResolvedValue({ default: () => <span>from cache</span> })
        const LazyThing = split(importFn, { ssr: false })
        await LazyThing.load()
        render(<LazyThing />)
        await waitFor(() => expect(screen.getByText("from cache")).toBeInTheDocument())
    })

    it("prefetches when window.__SSR_RENDERED_COMPONENTS__ already contains the cacheKey", async () => {
        const prev = window.__SSR_RENDERED_COMPONENTS__
        window.__SSR_RENDERED_COMPONENTS__ = new Set(["pages/Prefetched"])
        try {
            const importFn = vi.fn().mockResolvedValue({ default: () => <span>pf</span> })
            split(importFn, {}, undefined, "pages/Prefetched")
            // the constructor-time prefetch fired
            await waitFor(() => expect(importFn).toHaveBeenCalled())
        } finally {
            window.__SSR_RENDERED_COMPONENTS__ = prev
        }
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

// Mimics routeFetcherHmrPlugin's footer: record the replacement, update the
// registered splits, then announce it.
const hotUpdate = (prev, next, fetcherChanged = true) => {
    window.__CATALYST_HMR__.replaced.set(prev, next)
    const detail = { prev, next, fetcherChanged, serverFetcherChanged: false, splits: [], reload: false }
    window.__CATALYST_HMR__.splits.forEach((onUpdate) => onUpdate(detail))
    window.dispatchEvent(new CustomEvent("catalyst:route-module-updated", { detail }))
    return detail
}

describe("split() dev HMR updates", () => {
    const pageModule = (statics) => ({ default: Object.assign(() => <span>page</span>, statics) })

    beforeEach(() => {
        // The footer creates this in dev; splits only register when it exists.
        window.__CATALYST_HMR__ ||= { replaced: new WeakMap(), splits: new Set() }
    })

    it("swaps load() and the statics to the hot-updated module", async () => {
        const v1 = pageModule({ clientFetcher: () => "v1" })
        const v2 = pageModule({ clientFetcher: () => "v2" })
        const Page = split(() => Promise.resolve(v1), {})
        await Page.load()
        const detail = hotUpdate(v1, v2)
        expect(await Page.load()).toBe(v2)
        expect(Page.clientFetcher).toBe(v2.default.clientFetcher)
        expect(Page.__fetcherVersion).toBe(1)
        expect(detail.splits).toEqual([Page])
    })

    it("does not bump the fetcher version for a component-only edit", async () => {
        const v1 = pageModule({ clientFetcher: () => "v1" })
        const v2 = pageModule({ clientFetcher: v1.default.clientFetcher })
        const Page = split(() => Promise.resolve(v1), {})
        await Page.load()
        hotUpdate(v1, v2, false)
        expect(await Page.load()).toBe(v2)
        expect(Page.__fetcherVersion).toBeUndefined()
    })

    it("follows updates of a module whose default export keeps its identity", async () => {
        // e.g. a page that imports its component, sets the fetcher on it and re-exports it.
        const Component = () => <span>page</span>
        const v1 = { default: Component }
        const v2 = { default: Component }
        const v3 = { default: Component }
        const Page = split(() => Promise.resolve(v1), {})
        await Page.load()
        hotUpdate(v1, v2)
        hotUpdate(v2, v3)
        expect(await Page.load()).toBe(v3)
        const Later = split(() => Promise.resolve(v1), {})
        expect(await Later.load()).toBe(v3)
        // An update to some other module sharing that component is not this page's update.
        const unrelated = { default: Component }
        const detail = hotUpdate(unrelated, { default: Component })
        expect(detail.splits).toEqual([])
        expect(await Page.load()).toBe(v3)
    })

    it("ignores updates to modules a split has not loaded", async () => {
        const loaded = pageModule({ clientFetcher: () => "loaded" })
        const notLoaded = pageModule({ clientFetcher: () => "not loaded" })
        const Loaded = split(() => Promise.resolve(loaded), {})
        const NotLoaded = split(() => Promise.resolve(notLoaded), {})
        await Loaded.load()
        const detail = hotUpdate({}, { helper: true })
        expect(detail.splits).toEqual([])
        expect(await Loaded.load()).toBe(loaded)
        expect(await NotLoaded.load()).toBe(notLoaded)
    })

    it("loads the newest version when the module was hot-updated before this split loaded it", async () => {
        const v1 = pageModule({ clientFetcher: () => "v1" })
        const v2 = pageModule({ clientFetcher: () => "v2" })
        const v3 = pageModule({ clientFetcher: () => "v3" })
        hotUpdate(v1, v2)
        hotUpdate(v2, v3)
        const Page = split(() => Promise.resolve(v1), {})
        expect(await Page.load()).toBe(v3)
        expect(Page.clientFetcher).toBe(v3.default.clientFetcher)
    })

    it("removes statics the hot-updated module no longer defines", async () => {
        const v1 = pageModule({ clientFetcher: () => "v1", setMetaData: () => ({}) })
        const v2 = pageModule({ setMetaData: v1.default.setMetaData })
        const Page = split(() => Promise.resolve(v1), {})
        await Page.load()
        hotUpdate(v1, v2)
        expect(Page.clientFetcher).toBeUndefined()
        expect(Page.setMetaData).toBe(v1.default.setMetaData)
    })

    it("does not listen for updates when the dev footer never ran (production)", async () => {
        const hmr = window.__CATALYST_HMR__
        delete window.__CATALYST_HMR__
        const v1 = pageModule({ clientFetcher: () => "v1" })
        const Page = split(() => Promise.resolve(v1), {})
        await Page.load()
        window.__CATALYST_HMR__ = hmr
        const detail = hotUpdate(v1, pageModule({ clientFetcher: () => "v2" }))
        expect(detail.splits).toEqual([])
        expect(await Page.load()).toBe(v1)
    })
})
