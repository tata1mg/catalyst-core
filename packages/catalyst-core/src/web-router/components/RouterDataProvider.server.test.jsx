// @vitest-environment node
//
// Server-side coverage for serverDataFetcher / fetchRouteData (#347).
//
// fetchRouteData picks the fetcher like this:
//
//     let fetcher = component?.default?.clientFetcher
//     if (typeof window === "undefined") {
//         fetcher = component?.default?.serverFetcher
//     }
//
// The jsdom-environment tests in RouterDataProvider.test.jsx can only
// ever exercise the clientFetcher branch, because jsdom always defines
// `window`. This file runs in the "node" vitest project (no `window`),
// so it exercises the serverFetcher branch and the client/server
// precedence rule. Routed here by vitest.config.ts's `*.server.test.*`
// include/exclude split.

import { describe, expect, it, vi } from "vitest"
import { serverDataFetcher } from "./RouterDataProvider.jsx"

// Mirrors the loadable-component contract the production code relies on:
// `component` is only populated via `route.component.load()`.
function loadableComponent(mod) {
    return { load: () => Promise.resolve(mod) }
}

describe("serverDataFetcher (node environment — serverFetcher branch)", () => {
    it("sanity: this file runs with no `window` global", () => {
        expect(typeof window).toBe("undefined")
    })

    it("calls a matched route's serverFetcher (not clientFetcher) and keys the result by path", async () => {
        const serverFetcher = vi.fn().mockResolvedValue({ from: "server" })
        const clientFetcher = vi.fn().mockResolvedValue({ from: "client" })
        const routes = [
            { path: "/page", component: loadableComponent({ default: { serverFetcher, clientFetcher } }) },
        ]
        const req = { query: {} }

        const result = await serverDataFetcher({ routes, url: "/page", req }, { some: "arg" })
        const key = Object.keys(result)[0]

        expect(key).toBe("/page")
        expect(result[key].data).toEqual({ from: "server" })
        expect(result[key].error).toBeNull()
        expect(result[key].fetcherNotAvailable).toBe(false)
        expect(serverFetcher).toHaveBeenCalledWith(
            expect.objectContaining({ route: routes[0] }),
            { some: "arg" },
            undefined,
        )
        expect(clientFetcher).not.toHaveBeenCalled()
    })

    it("records the error and marks isFetched when the serverFetcher throws", async () => {
        const serverFetcher = vi.fn().mockRejectedValue(new Error("upstream 500"))
        const routes = [{ path: "/page", component: loadableComponent({ default: { serverFetcher } }) }]
        const req = { query: {} }

        const result = await serverDataFetcher({ routes, url: "/page", req }, {})
        const key = Object.keys(result)[0]

        expect(result[key].error).toBeInstanceOf(Error)
        expect(result[key].error.message).toBe("upstream 500")
        expect(result[key].isFetched).toBe(true)
        expect(result[key].isFetching).toBe(false)
    })

    it("marks fetcherNotAvailable when the matched route has only a clientFetcher (server has no serverFetcher)", async () => {
        const clientFetcher = vi.fn().mockResolvedValue({ from: "client" })
        const routes = [{ path: "/page", component: loadableComponent({ default: { clientFetcher } }) }]
        const req = { query: {} }

        const result = await serverDataFetcher({ routes, url: "/page", req }, {})
        const key = Object.keys(result)[0]

        expect(result[key].fetcherNotAvailable).toBe(true)
        expect(clientFetcher).not.toHaveBeenCalled()
    })

    it("returns an empty object when no route matches", async () => {
        const routes = [{ path: "/known", component: loadableComponent({ default: {} }) }]
        const req = { query: {} }

        const result = await serverDataFetcher({ routes, url: "/unknown", req }, {})
        expect(result).toEqual({})
    })

    it("builds the query-string suffix onto the route key from req.query", async () => {
        const serverFetcher = vi.fn().mockResolvedValue({})
        const routes = [{ path: "/page", component: loadableComponent({ default: { serverFetcher } }) }]
        const req = { query: { a: "1", b: "2" } }

        const result = await serverDataFetcher({ routes, url: "/page", req }, {})
        expect(Object.keys(result)[0]).toBe("/page?a=1&b=2")
    })
})
