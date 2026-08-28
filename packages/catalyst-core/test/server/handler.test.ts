import { Writable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// SSR request handler tests (#348).
//
// handler.jsx statically imports the consumer app's App / routes / store /
// document through "@catalyst/template". vitest.config.ts's "node" project
// aliases that specifier to test/server/fixtures/template so the module
// can load at all. The fixture App defines `serverSideFunction` (the
// implicit contract handler.jsx calls unconditionally).
//
// Scope, matching #348's acceptance criteria:
//   - successful render: 200 + streamed HTML containing the app tree
//   - streaming completes: the returned promise resolves, res ends
//   - error propagation: a throwing serverSideFunction / fetcher is
//     caught, logged via logSSRError, and still produces a response
//
// Deeper streaming timing / deferred-asset behavior already has Tier-2
// coverage via examples/error-catalog (RUNTIME-WEB-*) and the Playwright
// fixture (#412); not re-litigated here.

// A real Writable so renderToPipeableStream's Transform -> res pipe works;
// a bag of vi.fn()s would hang. Collects chunks and exposes the express
// surface handler.jsx actually touches.
function makeReqRes(url = "/") {
    const chunks: Buffer[] = []
    let ended = false

    const res: any = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(Buffer.from(chunk))
            cb()
        },
        final(cb) {
            ended = true
            cb()
        },
    })
    const endPromise = new Promise<void>((resolve) => {
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
    res.setHeader = vi.fn((k: string, v: string) => {
        res.headers[k] = v
        return res
    })
    res.status = vi.fn((code: number) => {
        res.statusCode = code
        return res
    })
    res.send = vi.fn(() => {
        res.headersSent = true
        return res
    })
    res.getHtml = () => Buffer.concat(chunks).toString("utf8")
    res.waitForEnd = () => endPromise
    res.isEnded = () => ended

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

// Set the env handler.jsx + its render helpers read at module load /
// render time before the first import. In production these are always set
// by serve.js / start.js; unset here they'd make render.js:18
// (`JSON.parse(IS_DEV_COMMAND)`) throw and the render promise hang.
beforeEach(() => {
    process.env.src_path = process.cwd()
    process.env.BUILD_OUTPUT_PATH = "build"
    process.env.APPLICATION = "test"
    process.env.IS_DEV_COMMAND = "false"
    process.env.PUBLIC_STATIC_ASSET_URL = "http://localhost"
    process.env.PUBLIC_STATIC_ASSET_PATH = "/assets/"
    vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
})

describe("SSR handler", () => {
    it("renders a matched route: sets 200, streams HTML containing the document root", async () => {
        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes("/")

        await handler(req, res)
        await res.waitForEnd()

        expect(res.status).toHaveBeenCalledWith(200)
        const html = res.getHtml()
        expect(html).toContain("data-testid=\"doc-root\"")
        expect(html).toContain("<html")
        // the bot marker script the tail transform always appends
        expect(html).toContain("window.__CATALYST_IS_BOT__=false")
        expect(res.isEnded()).toBe(true)
    })

    it("returns a 404 status for a catch-all (no concrete) route match", async () => {
        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes("/does-not-exist")

        await handler(req, res)
        await res.waitForEnd()

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.getHtml()).toContain("<html")
    })

    it("renders with the fetcher error's status_code when a route serverFetcher rejects", async () => {
        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes("/fetcher-error")

        await handler(req, res)
        await res.waitForEnd()

        // serverDataFetcher caught the reject into fetcherData[url].error;
        // _handler used err.status_code (503) for the render.
        expect(res.status).toHaveBeenCalledWith(503)
        expect(res.getHtml()).toContain("<html")
    })

    it("propagates a throwing App.serverSideFunction: logs SERVER_SIDE_FUNCTION, still responds", async () => {
        const AppModule = await import(
            "../server/fixtures/template/src/js/containers/App/index.jsx"
        )
        vi.spyOn(AppModule.default, "serverSideFunction").mockRejectedValueOnce(
            new Error("server-side boom"),
        )

        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes("/")

        await handler(req, res)
        await res.waitForEnd()

        // logSSRError -> console.error, stage tag in the formatted output
        const logged = (console.error as any).mock.calls.flat().join("\n")
        expect(logged).toMatch(/server-side boom|SERVER_SIDE_FUNCTION|RUNTIME-WEB/)
        // the catch branch still renders (error.status_code is undefined ->
        // _renderMarkUp computes a status and streams)
        expect(res.getHtml()).toContain("<html")
    })

    it("does not throw out of handler when request handling fails entirely", async () => {
        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        // a req with no originalUrl / no get() -> NestedMatchRoutes and
        // parseSafeAreaFromHeaders paths hit undefined; the outer
        // try/catch must swallow it (REQUEST_HANDLING stage).
        const res: any = new Writable({ write: (_c, _e, cb) => cb() })
        res.set = vi.fn().mockReturnThis()
        res.status = vi.fn().mockReturnThis()
        res.setHeader = vi.fn().mockReturnThis()
        res.headersSent = false

        await expect(handler({} as any, res)).resolves.toBeUndefined()
        const logged = (console.error as any).mock.calls.flat().join("\n")
        // wrapSSRError("REQUEST_HANDLING", …) -> RUNTIME-WEB-004; pin the
        // stage, not just "some SSR error".
        expect(logged).toContain("RUNTIME-WEB-004")
    })
})
