import { Writable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// SSR handler: partial prerendering (renderMode "ppr") and the static full-page cache
// (renderMode "static"). Fixture routes /ppr and /static in fixtures/template/src/js/routes.

const TEMPLATE_DOC = "@catalyst/template/server/document"

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

async function load() {
    const { default: handler } = await import("../../src/server/renderer/handler.jsx")
    return async (url: string, opts?: any) => {
        const { req, res } = makeReqRes(url, opts)
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
        vi.doMock("@catalyst/template/server/index.js", () => ({
            onRouteMatch: undefined,
            onFetcherSuccess: undefined,
            onFetcherError: undefined,
            onAppServerSideSuccess: undefined,
            onAppServerSideError: undefined,
            onRenderError: undefined,
            onRequestError: undefined,
            getEarlyHintLinks: undefined,
            getPPRShellKey: () => null,
            getPPRPreloadKey: undefined,
            beforePPRFlush: undefined,
        }))
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A })
        expect(page.mode).toBeUndefined()
        expect(page.html).toContain("user-aaaaaaaaaaaa")
        vi.doUnmock("@catalyst/template/server/index.js")
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
