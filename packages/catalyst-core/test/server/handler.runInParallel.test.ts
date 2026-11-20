import { Writable } from "node:stream"
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// SSR handler tests for runInParallel, the promises serverSideFunction hands
// back to run alongside page fetchers. handler.test.ts covers the request
// lifecycle without it. Deferred promises decide every ordering here, so no
// assertion depends on timers.
//
// Pinned behaviour:
//   - fetchers start while registered work is pending; hooks and render wait for both
//   - a rejection with no response sent takes the serverSideFunction error path
//   - a response already sent wins over a rejection
//   - serverSideFunction throwing with work pending waits for it and keeps its own error
//   - every exit records the work on one App.serverSideFunction.runInParallel span
//   - a nullish rejection reaches the error path as an Error instead of breaking it
//   - an app that never calls runInParallel gets no new span and still has a
//     returned promise awaited before fetchers start

const PARALLEL_SPAN = "App.serverSideFunction.runInParallel"

function deferred<T = void>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

// Lets every pending promise chain in the handler run. Nothing on these paths
// uses timers, so a few event-loop turns drain them.
const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
}

let events: string[] = []
let fetcherGate = deferred()
const spans: { name: string; status: string; error?: string }[] = []
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => unhandled.push(reason)

// All seven hooks handler.jsx reads: a key missing from a vi.doMock factory
// throws on access, and the handler's import try/catch would then drop the rest.
const hooks = {
    onRouteMatch: undefined,
    onFetcherSuccess: vi.fn((_args: any) => {
        events.push("onFetcherSuccess")
    }),
    onFetcherError: vi.fn((_args: any) => {
        events.push("onFetcherError")
    }),
    onAppServerSideSuccess: vi.fn((_args: any) => {
        events.push("onAppServerSideSuccess")
    }),
    onAppServerSideError: vi.fn((_args: any) => {
        events.push("onAppServerSideError")
    }),
    onRenderError: undefined,
    onRequestError: undefined,
}

// Same contract as withObservability in src/otel.js: a throw marks the span
// ERROR with err.message, read without a null check as otel.js does, and is
// rethrown.
const fakeOtel = {
    withObservability: (_service: string, fn: any, name: string) =>
        async function (...args: any[]) {
            const span: { name: string; status: string; error?: string } = { name, status: "OK" }
            spans.push(span)
            try {
                return await fn(...args)
            } catch (err: any) {
                span.status = "ERROR"
                span.error = err.message
                throw err
            }
        },
    withSyncObservability: (_service: string, fn: any) => fn,
}

// serverDataFetcher reads serverFetcher off a loadable-style component.
const loadable = (Component: any) =>
    Object.assign(Component, { load: () => Promise.resolve({ default: Component }) })

const FetchPage = loadable(
    Object.assign(() => React.createElement("p", null, "fetch page"), {
        serverFetcher: async () => {
            events.push("fetcherStart")
            await fetcherGate.promise
            events.push("fetcherEnd")
            return { ok: true }
        },
    })
)

const RedirectPage = loadable(
    Object.assign(() => React.createElement("p", null, "redirect page"), {
        serverFetcher: async ({ res }: any) => {
            res.redirect(302, "/elsewhere")
        },
    })
)

const routes = [
    { path: "/", component: () => React.createElement("p", null, "home") },
    { path: "/fetch", component: FetchPage },
    { path: "/redirect", component: RedirectPage },
    { path: "*", component: () => React.createElement("p", null, "not found") },
]

// A real Writable so renderToPipeableStream can pipe into it, plus the express
// surface the handler and these fixtures touch.
function makeReqRes(url: string) {
    const chunks: Buffer[] = []
    const res: any = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(Buffer.from(chunk))
            cb()
        },
    })
    const ended = new Promise<void>((resolve) => {
        res.on("finish", resolve)
        res.on("close", resolve)
    })
    res.headers = {}
    res.statusCode = 200
    res.headersSent = false
    res.set = vi.fn((obj: Record<string, string>) => {
        Object.assign(res.headers, obj)
        return res
    })
    res.setHeader = vi.fn((key: string, value: string) => {
        res.headers[key] = value
        return res
    })
    res.status = vi.fn((code: number) => {
        res.statusCode = code
        return res
    })
    res.redirect = vi.fn((code: number, location: string) => {
        res.statusCode = code
        res.headers.location = location
        res.headersSent = true
        res.end()
        return res
    })
    res.html = () => Buffer.concat(chunks).toString("utf8")
    res.waitForEnd = () => ended

    const req: any = {
        originalUrl: url,
        url,
        method: "GET",
        query: {},
        headers: { "user-agent": "test" },
        get(name: string) {
            return this.headers[name.toLowerCase()]
        },
    }
    return { req, res }
}

async function load({ otel = false } = {}) {
    vi.doMock("@catalyst/template/server/index.js", () => hooks)
    vi.doMock("./fixtures/template/src/js/routes/index.jsx", () => ({ default: routes }))
    if (otel) {
        // handler.jsx loads otel.js only for the boolean true, as config.json sets it.
        // Assigning to process.env would turn it into the string "true", so swap the object.
        process.env = { ...process.env, OTEL_ENABLE: true as any }
        vi.doMock("../../src/otel.js", () => fakeOtel)
    }
    const App: any = (await import("./fixtures/template/src/js/containers/App/index.jsx")).default
    const { default: handler } = await import("../../src/server/renderer/handler.jsx")
    return { App, handler }
}

const parallelSpans = () => spans.filter((span) => span.name === PARALLEL_SPAN)

const originalEnv = process.env

beforeEach(() => {
    process.env.src_path = process.cwd()
    process.env.BUILD_OUTPUT_PATH = "build"
    process.env.APPLICATION = "test"
    process.env.PUBLIC_STATIC_ASSET_URL = "http://localhost"
    process.env.PUBLIC_STATIC_ASSET_PATH = "/assets/"
    vi.spyOn(console, "error").mockImplementation(() => {})
    events = []
    fetcherGate = deferred()
    spans.length = 0
    unhandled.length = 0
    process.on("unhandledRejection", onUnhandled)
})

afterEach(() => {
    process.off("unhandledRejection", onUnhandled)
    process.env = originalEnv
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.doUnmock("@catalyst/template/server/index.js")
    vi.doUnmock("./fixtures/template/src/js/routes/index.jsx")
    vi.doUnmock("../../src/otel.js")
    vi.resetModules()
})

describe("SSR handler: runInParallel", () => {
    it("without it, a returned promise is still awaited before fetchers start and no runInParallel span is made", async () => {
        const { App, handler } = await load({ otel: true })
        const ssf = deferred()
        let received: unknown
        vi.spyOn(App, "serverSideFunction").mockImplementation((args: any) => {
            received = args.runInParallel
            return ssf.promise
        })
        fetcherGate.resolve()
        const { req, res } = makeReqRes("/fetch")

        const done = handler(req, res)
        await settle()
        expect(typeof received).toBe("function")
        expect(events).toEqual([])

        ssf.resolve()
        await done
        await res.waitForEnd()

        expect(events).toEqual(["onAppServerSideSuccess", "fetcherStart", "fetcherEnd", "onFetcherSuccess"])
        expect(res.statusCode).toBe(200)
        expect(parallelSpans()).toEqual([])
    })

    it.each(["fetcher", "registered work"])(
        "fetchers overlap registered work, and hooks and render wait until the %s finishes last",
        async (last) => {
            const { App, handler } = await load({ otel: true })
            const work = deferred()
            vi.spyOn(App, "serverSideFunction").mockImplementation(async ({ runInParallel }: any) => {
                runInParallel(work.promise.then(() => events.push("workEnd")))
            })
            const { req, res } = makeReqRes("/fetch")

            const done = handler(req, res)
            await settle()
            // The fetcher started while the registered work is still pending.
            expect(events).toEqual(["onAppServerSideSuccess", "fetcherStart"])

            const [first, second] = last === "fetcher" ? [work, fetcherGate] : [fetcherGate, work]
            first.resolve()
            await settle()
            expect(events).not.toContain("onFetcherSuccess")
            expect(res.status).not.toHaveBeenCalled()

            second.resolve()
            await done
            await res.waitForEnd()

            expect(events.at(-1)).toBe("onFetcherSuccess")
            expect(res.statusCode).toBe(200)
            expect(res.html()).toContain("fetch page")
            expect(parallelSpans()).toEqual([{ name: PARALLEL_SPAN, status: "OK" }])
        }
    )

    it("a rejection with no response sent takes the serverSideFunction error path once fetchers settle", async () => {
        const { App, handler } = await load({ otel: true })
        const work = deferred()
        vi.spyOn(App, "serverSideFunction").mockImplementation(async ({ runInParallel }: any) => {
            runInParallel(work.promise)
        })
        const { req, res } = makeReqRes("/fetch")

        const done = handler(req, res)
        await settle()
        const failure = Object.assign(new Error("nav down"), { status_code: 502 })
        work.reject(failure)
        await settle()
        // Still waiting for the fetcher.
        expect(hooks.onAppServerSideError).not.toHaveBeenCalled()

        fetcherGate.resolve()
        await done
        await res.waitForEnd()

        expect(events).toEqual([
            "onAppServerSideSuccess",
            "fetcherStart",
            "fetcherEnd",
            "onAppServerSideError",
        ])
        expect(hooks.onAppServerSideError.mock.calls[0][0].error).toBe(failure)
        expect(res.statusCode).toBe(502)
        expect(res.html()).toContain("<html")
        expect((console.error as any).mock.calls.flat().join("\n")).toContain("RUNTIME-WEB-003")
        // One span, although the failure passes through both the success path and the catch.
        expect(parallelSpans()).toEqual([{ name: PARALLEL_SPAN, status: "ERROR", error: "nav down" }])
        expect(unhandled).toEqual([])
    })

    it("a response a fetcher already sent wins over a rejection, which is still traced", async () => {
        const { App, handler } = await load({ otel: true })
        vi.spyOn(App, "serverSideFunction").mockImplementation(async ({ runInParallel }: any) => {
            runInParallel(Promise.reject(new Error("nav down")))
        })
        const { req, res } = makeReqRes("/redirect")

        await handler(req, res)

        expect(res.redirect).toHaveBeenCalledWith(302, "/elsewhere")
        expect(res.status).not.toHaveBeenCalled()
        expect(hooks.onAppServerSideError).not.toHaveBeenCalled()
        expect(parallelSpans()).toEqual([{ name: PARALLEL_SPAN, status: "ERROR", error: "nav down" }])
        expect(unhandled).toEqual([])
    })

    it("a response serverSideFunction already sent still waits for registered work before the handler returns", async () => {
        const { App, handler } = await load({ otel: true })
        const work = deferred()
        vi.spyOn(App, "serverSideFunction").mockImplementation(async ({ res, runInParallel }: any) => {
            runInParallel(work.promise)
            res.redirect(302, "/login")
        })
        const { req, res } = makeReqRes("/fetch")

        let returned = false
        const done = handler(req, res).then(() => {
            returned = true
        })
        await settle()
        expect(res.redirect).toHaveBeenCalledWith(302, "/login")
        expect(returned).toBe(false)

        work.resolve()
        await done

        expect(events).toEqual(["onAppServerSideSuccess"])
        expect(parallelSpans()).toEqual([{ name: PARALLEL_SPAN, status: "OK" }])
    })

    it("serverSideFunction throwing with work pending waits for it, traces it, and keeps its own error", async () => {
        const { App, handler } = await load({ otel: true })
        const work = deferred()
        const ssfError = Object.assign(new Error("ssf boom"), { status_code: 503 })
        vi.spyOn(App, "serverSideFunction").mockImplementation(async ({ runInParallel }: any) => {
            runInParallel(work.promise)
            throw ssfError
        })
        const { req, res } = makeReqRes("/fetch")

        const done = handler(req, res)
        await settle()
        expect(hooks.onAppServerSideError).not.toHaveBeenCalled()

        work.reject(new Error("nav down"))
        await done
        await res.waitForEnd()

        expect(events).toEqual(["onAppServerSideError"])
        expect(hooks.onAppServerSideError.mock.calls[0][0].error).toBe(ssfError)
        expect(res.statusCode).toBe(503)
        expect(parallelSpans()).toEqual([{ name: PARALLEL_SPAN, status: "ERROR", error: "nav down" }])
        expect(unhandled).toEqual([])
    })

    it.each([
        [null, false],
        [undefined, false],
        [null, true],
        [undefined, true],
    ])(
        "a %s rejection (OTEL %s) reaches the error path as an Error and the page still renders",
        async (reason, otel) => {
            const { App, handler } = await load({ otel })
            vi.spyOn(App, "serverSideFunction").mockImplementation(async ({ runInParallel }: any) => {
                runInParallel(Promise.reject(reason))
            })
            const { req, res } = makeReqRes("/")

            await handler(req, res)
            await res.waitForEnd()

            const { error } = hooks.onAppServerSideError.mock.calls[0][0]
            expect(error).toBeInstanceOf(Error)
            expect(error.message).toBe(String(reason))
            expect(res.statusCode).toBe(200)
            expect(res.html()).toContain('data-testid="doc-root"')
        }
    )

    it("a rejection that settles before serverSideFunction returns is never reported as unhandled", async () => {
        const { App, handler } = await load()
        vi.spyOn(App, "serverSideFunction").mockImplementation(async ({ runInParallel }: any) => {
            runInParallel(Promise.reject(Object.assign(new Error("early"), { status_code: 500 })))
            // A full event-loop turn, so Node gets its chance to flag an unhandled rejection.
            await new Promise((resolve) => setImmediate(resolve))
        })
        const { req, res } = makeReqRes("/")

        await handler(req, res)
        await res.waitForEnd()

        expect(unhandled).toEqual([])
        expect(res.statusCode).toBe(500)
    })
})
