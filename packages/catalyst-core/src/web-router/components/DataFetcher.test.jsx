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

class Boundary extends React.Component {
    state = { error: null }
    static getDerivedStateFromError(error) {
        return { error }
    }
    render() {
        return this.state.error ? <p data-testid="error">{this.state.error.message}</p> : this.props.children
    }
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

    it("does not cache a failed fetch: the next render fetches again", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        const fetcher = vi
            .fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValue({ value: "fetched" })

        await renderReader(fetcher, (el) => <Boundary>{el}</Boundary>)
        expect(await screen.findByTestId("error")).toHaveTextContent("network down")
        expect(fetcher).toHaveBeenCalledTimes(1)

        // A render right away still gets the failure; one after FAILED_FETCH_KEEP_MS fetches again.
        const now = Date.now()
        vi.spyOn(Date, "now").mockReturnValue(now + 2500)
        await renderReader(fetcher, (el) => <Boundary>{el}</Boundary>)
        expect(await screen.findByTestId("data")).toHaveTextContent("fetched")
        expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it("does not refetch in a loop when the fetcher always fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        const fetcher = vi.fn(async () => {
            throw new Error("always down")
        })
        await renderReader(fetcher, (el) => <Boundary>{el}</Boundary>)
        expect(await screen.findByTestId("error")).toHaveTextContent("always down")
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it("keeps at most 100 paths in the client cache, dropping the oldest", async () => {
        const fetcher = vi.fn(async () => ({ value: "fetched" }))
        const first = window.location.pathname
        await renderReader(fetcher)
        for (let i = 0; i < 100; i++) {
            window.history.replaceState(null, "", `/page-${i}`)
            await renderReader(fetcher)
        }
        expect(fetcher).toHaveBeenCalledTimes(101)
        window.history.replaceState(null, "", first)
        await renderReader(fetcher) // evicted, so fetched again
        expect(fetcher).toHaveBeenCalledTimes(102)
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
