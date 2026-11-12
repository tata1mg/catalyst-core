import React from "react"
import { Writable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// SSR handler: partial prerendering (renderMode "ppr") and the static full-page cache
// (renderMode "static"). Fixture routes /ppr and /static in fixtures/template/src/js/routes.

const TEMPLATE_DOC = "@catalyst/template/server/document"
const HOOKS = "@catalyst/template/server/index.js"

// vitest mocks throw on exports the factory leaves out, and the handler reads every hook.
const mockHooks = (hooks: Record<string, any>) =>
    vi.doMock(HOOKS, () => ({
        onRouteMatch: undefined,
        onFetcherSuccess: undefined,
        onFetcherError: undefined,
        onAppServerSideSuccess: undefined,
        onAppServerSideError: undefined,
        onRenderError: undefined,
        onRequestError: undefined,
        getEarlyHintLinks: undefined,
        getPPRShellKey: undefined,
        getPPRPreloadKey: undefined,
        beforePPRFlush: undefined,
        ...hooks,
    }))

// A custom Document that writes a cookie value outside <PPRDynamic>, i.e. into the shared shell.
const leakyDocument = (props: any) =>
    React.createElement(
        "html",
        null,
        React.createElement("head", null),
        React.createElement(
            "body",
            null,
            React.createElement("span", null, props.req?.cookies?.user),
            props.jsx
        )
    )

// A Writable whose headersSent turns true once the first byte is written, like a real
// ServerResponse, so the PPR path's late-call guards behave as in production.
function makeReqRes(url: string, { cookies = {}, userAgent = "Mozilla/5.0 test" } = {}) {
    const chunks: Buffer[] = []
    let started = false
    const res: any = new Writable({
        write(chunk, _enc, cb) {
            started = true
            chunks.push(Buffer.from(chunk))
            cb()
        },
    })
    Object.defineProperty(res, "headersSent", { get: () => started })
    const endPromise = new Promise<void>((resolve) => {
        res.on("finish", resolve)
        res.on("close", resolve)
    })
    res.headers = {} as Record<string, string>
    res.locals = {}
    res.statusCode = 200
    res.set = vi.fn((obj: Record<string, string>) => Object.assign(res.headers, obj) && res)
    res.setHeader = vi.fn((k: string, v: string) => {
        res.headers[k.toLowerCase()] = v
        return res
    })
    res.status = vi.fn((code: number) => {
        res.statusCode = code
        return res
    })
    res.send = vi.fn((body: string) => {
        res.end(body)
        return res
    })
    res.cookie = vi.fn(() => res)
    res.clearCookie = vi.fn(() => res)
    res.redirect = vi.fn(() => res)
    res.getHtml = () => Buffer.concat(chunks).toString("utf8")
    res.waitForEnd = () => endPromise

    const req: any = {
        originalUrl: url,
        url,
        method: "GET",
        query: {},
        cookies,
        headers: { "user-agent": userAgent },
        get(name: string) {
            return this.headers[name.toLowerCase()]
        },
    }
    return { req, res }
}

async function load(query: Record<string, string> = {}) {
    const { default: handler } = await import("../../src/server/renderer/handler.jsx")
    return async (url: string, opts: any = {}) => {
        const { req, res } = makeReqRes(url, opts)
        req.query = { ...query, ...(opts.query || {}) }
        if (opts.nonce) res.locals.cspNonce = opts.nonce
        await handler(req, res)
        await res.waitForEnd()
        return { html: res.getHtml() as string, mode: res.headers["x-rendering-mode"], res }
    }
}

// At runtime process.env is the plain object built from config.json (booleans stay booleans).
let realEnv: NodeJS.ProcessEnv
beforeEach(() => {
    realEnv = process.env
    process.env = { ...realEnv, src_path: process.cwd(), BUILD_OUTPUT_PATH: "build", APPLICATION: "test" }
    vi.doMock(TEMPLATE_DOC, () => ({ default: undefined }))
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
    process.env = realEnv
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock(TEMPLATE_DOC)
    vi.doUnmock(HOOKS)
    delete (global as any).__CHUNK_EXTRACTOR__
    delete (process as any).deferredAssetsByRoute
    delete (process as any).cssFileCache
})

const USER_A = { user: "user-aaaaaaaaaaaa" }
const USER_B = { user: "user-bbbbbbbbbbbb" }

describe("SSR handler — partial prerendering", () => {
    it("builds the shell once, then replays it; each response resumes with its own request's data", async () => {
        ;(process.env as any).PPR_ENABLE = true
        const get = await load()

        const first = await get("/ppr", { cookies: USER_A })
        expect(first.mode).toBe("ppr-miss")
        expect(first.html).toContain("user:<!-- -->user-aaaaaaaaaaaa")
        expect(first.html).toContain("window.__CATALYST_PPR__=true")

        const second = await get("/ppr", { cookies: USER_B })
        expect(second.mode).toBe("ppr-hit")
        expect(second.html).toContain("user:<!-- -->user-bbbbbbbbbbbb")
        expect(second.html).not.toContain("user-aaaaaaaaaaaa")

        // The replayed shell is the same bytes for both visitors: the skeleton, and no state script.
        const shellOf = (html: string) => html.slice(0, html.indexOf("ppr-skeleton"))
        expect(shellOf(second.html)).toBe(shellOf(first.html))
        expect(shellOf(second.html)).not.toContain("__INITIAL_STATE__")
        // This request's state comes after the app, in the trailer.
        expect(second.html.indexOf("window.__INITIAL_STATE__")).toBeGreaterThan(
            second.html.indexOf("user-bbbb")
        )
    })

    it("serves bots the classic render", async () => {
        ;(process.env as any).PPR_ENABLE = true
        const get = await load()
        const bot = await get("/ppr", {
            cookies: USER_A,
            userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        })
        expect(bot.mode).toBeUndefined()
        expect(bot.html).toContain("user-aaaaaaaaaaaa")
        expect(bot.html).not.toContain("__CATALYST_PPR__")
    })

    it("uses the classic path when PPR_ENABLE is off", async () => {
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A })
        expect(page.mode).toBeUndefined()
        expect(page.html).toContain("user-aaaaaaaaaaaa")
        expect(page.html).not.toContain("__CATALYST_PPR__")
    })

    it("uses the classic path when getPPRShellKey returns null", async () => {
        ;(process.env as any).PPR_ENABLE = true
        mockHooks({ getPPRShellKey: () => null })
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A })
        expect(page.mode).toBeUndefined()
        expect(page.html).toContain("user-aaaaaaaaaaaa")
    })
})

describe("SSR handler — static full-page cache", () => {
    it("renders a static route once and replays the cached bytes", async () => {
        const get = await load()
        const routes: any = await import("./fixtures/template/src/js/routes/index.jsx")
        const before = routes.getStaticRenders()

        const first = await get("/static")
        const second = await get("/static")

        expect(first.mode).toBe("static-cache-miss")
        expect(second.mode).toBe("static-cache-hit")
        expect(second.html).toBe(first.html)
        expect(first.html).toContain("static page")
        expect(routes.getStaticRenders() - before).toBe(1)
    })
})

describe("SSR handler — PPR request handling", () => {
    beforeEach(() => {
        ;(process.env as any).PPR_ENABLE = true
    })

    it("exposes a fetcher error as window.__STATUS_CODE__ (the status line is already sent)", async () => {
        const get = await load()
        const page = await get("/ppr-error")
        expect(page.mode).toBe("ppr-miss")
        expect(page.html).toContain("window.__STATUS_CODE__=503")
        expect(page.html).toContain("ppr error page")
    })

    it("sends usePPRRouteData results as window.cachedData", async () => {
        const get = await load()
        const page = await get("/ppr-hook")
        expect(page.mode).toBe("ppr-miss")
        expect(page.html).toContain("hook data")
        expect(page.html).toContain('window.cachedData={"/ppr-hook":{"value":"hook data"}}')
    })

    it("replays a cookie set after the shell went out with document.cookie", async () => {
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A, query: { late: "" } })
        expect(page.html).toContain("document.cookie=")
        expect(page.html).toContain("late=1")
    })

    it("swaps in each response's own CSP nonce", async () => {
        const get = await load()
        const first = await get("/ppr", { cookies: USER_A, nonce: "nonce-one" })
        const second = await get("/ppr", { cookies: USER_B, nonce: "nonce-two" })
        expect(second.mode).toBe("ppr-hit")
        expect(first.html).toContain('nonce="nonce-one"')
        expect(second.html).toContain('nonce="nonce-two"')
        expect(second.html).not.toContain("nonce-one")
    })

    it("finishes the response and reports the error when the app throws while resuming", async () => {
        const onRenderError = vi.fn()
        mockHooks({ onRenderError })
        const get = await load()
        const page = await get("/ppr", { cookies: { user: "throw-while-resuming" } })
        expect(page.mode).toBe("ppr-miss")
        expect(page.html).toContain("window.__CATALYST_PPR__=true")
        expect(onRenderError).toHaveBeenCalled()
    })

    it("hands the rest to the client when the resume times out", async () => {
        ;(process.env as any).PPR_RESUME_TIMEOUT_MS = 1
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A, query: { slow: "" } })
        expect(page.mode).toBe("ppr-miss")
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("timed out"))
    })

    it("calls beforePPRFlush and keeps serving when getPPRPreloadKey throws", async () => {
        const beforePPRFlush = vi.fn()
        mockHooks({
            beforePPRFlush,
            getPPRPreloadKey: () => {
                throw new Error("no preload key")
            },
        })
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A })
        expect(page.mode).toBe("ppr-miss")
        expect(beforePPRFlush).toHaveBeenCalled()
        expect(page.html).toContain("user-aaaaaaaaaaaa")
    })

    it("uses the classic path when getPPRShellKey throws", async () => {
        mockHooks({
            getPPRShellKey: () => {
                throw new Error("no shell key")
            },
        })
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A })
        expect(page.mode).toBeUndefined()
        expect(page.html).toContain("user-aaaaaaaaaaaa")
    })

    it("does not cache a shell that contains a request cookie value", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: leakyDocument }))
        const get = await load()
        const first = await get("/ppr", { cookies: USER_A })
        const second = await get("/ppr", { cookies: USER_B })
        // Both served classic: the failed key is not retried for a minute.
        expect(first.mode).toBeUndefined()
        expect(second.mode).toBeUndefined()
        expect(second.html).not.toContain("user-aaaaaaaaaaaa")
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("shell contains request cookie values")
        )
    })

    it("serves a request classic when PPR_SHELL_BUILDS_MAX shells are already building", async () => {
        ;(process.env as any).PPR_SHELL_BUILDS_MAX = 1
        mockHooks({ getPPRShellKey: ({ req }: any) => req.query.k })
        const get = await load()
        const [a, b] = await Promise.all([
            get("/ppr", { cookies: USER_A, query: { k: "one" } }),
            get("/ppr", { cookies: USER_B, query: { k: "two" } }),
        ])
        expect([a.mode, b.mode].sort()).toEqual(["ppr-miss", undefined].sort())
    })
})

describe("SSR handler — static cache guards", () => {
    it("does not cache a static page that contains a request cookie value", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: leakyDocument }))
        const get = await load()
        const first = await get("/static", { cookies: USER_A })
        const second = await get("/static", { cookies: USER_B })
        expect(first.mode).toBe("static-cache-miss")
        expect(second.mode).toBe("static-cache-miss")
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("page contains request cookie values")
        )
    })

    it("answers 500 when a static page fails to render", async () => {
        const get = await load()
        const page = await get("/static-error")
        expect(page.res.statusCode).toBe(500)
    })

    it("renders fresh when the response carries a CSP nonce", async () => {
        const get = await load()
        const page = await get("/static", { nonce: "n" })
        expect(page.mode).toBeUndefined()
        expect(page.html).toContain("static page")
    })
})
