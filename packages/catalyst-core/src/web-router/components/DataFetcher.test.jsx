import React, { Suspense } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import {
    PPRDataProvider,
    clearPPRCache,
    createPPRRequestCache,
    getRequestCachedData,
    usePPRRouteData,
} from "./DataFetcher.jsx"
import { PPRRenderProvider } from "./PPR.jsx"

function Reader({ fetcher }) {
    const data = usePPRRouteData(fetcher)
    return <p data-testid="data">{data.value}</p>
}

const renderReader = async (fetcher, wrap = (el) => el) => {
    await act(async () => {
        render(wrap(<Suspense fallback={<p>loading</p>}>{<Reader fetcher={fetcher} />}</Suspense>))
    })
}

afterEach(() => {
    clearPPRCache()
    delete window.cachedData
})

describe("usePPRRouteData (client)", () => {
    it("hydrates from window.cachedData without calling the fetcher", async () => {
        window.cachedData = { [window.location.pathname]: { value: "from server" } }
        const fetcher = vi.fn(async () => ({ value: "fetched" }))
        await renderReader(fetcher)
        expect(screen.getByTestId("data")).toHaveTextContent("from server")
        expect(fetcher).not.toHaveBeenCalled()
        // Consumed once, so a later navigation fetches fresh data.
        expect(window.cachedData[window.location.pathname]).toBeUndefined()
    })

    it("fetches when nothing was sent and caches the result for later renders", async () => {
        const fetcher = vi.fn(async () => ({ value: "fetched" }))
        await renderReader(fetcher)
        expect(await screen.findByTestId("data")).toHaveTextContent("fetched")
        await renderReader(fetcher)
        expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it("fetches again after clearPPRCache()", async () => {
        const fetcher = vi.fn(async () => ({ value: "fetched" }))
        await renderReader(fetcher)
        clearPPRCache()
        await renderReader(fetcher)
        expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it("suspends without fetching while the PPR shell is prerendered", async () => {
        const fetcher = vi.fn(async () => ({ value: "fetched" }))
        await renderReader(fetcher, (el) => (
            <PPRRenderProvider value={{ phase: "prerender" }}>{el}</PPRRenderProvider>
        ))
        expect(screen.getByText("loading")).toBeInTheDocument()
        expect(fetcher).not.toHaveBeenCalled()
    })

    it("suspends in a PPRDataProvider prerender phase too", async () => {
        const fetcher = vi.fn(async () => ({ value: "fetched" }))
        await renderReader(fetcher, (el) => <PPRDataProvider phase="prerender">{el}</PPRDataProvider>)
        expect(screen.getByText("loading")).toBeInTheDocument()
        expect(fetcher).not.toHaveBeenCalled()
    })
})

describe("request cache helpers", () => {
    it("getRequestCachedData reads what a request cache holds", () => {
        const cache = createPPRRequestCache()
        expect(getRequestCachedData(cache, "/")).toBeUndefined()
        cache.data.set("/", { value: 1 })
        expect(getRequestCachedData(cache, "/")).toEqual({ value: 1 })
        expect(getRequestCachedData(undefined, "/")).toBeUndefined()
    })
})
