import React from "react"
import { Writable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// SSR handler: partial prerendering (renderMode "ppr") and the static full-page cache
// (renderMode "static"). Fixture routes /ppr and /static in fixtures/template/src/js/routes.

const TEMPLATE_DOC = "@catalyst/template/server/document"
const HOOKS = "@catalyst/template/server/index.js"
const ROUTER_DATA = "../../src/web-router/components/RouterDataProvider.jsx"

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
// The app Document for the current test (undefined: the built-in one). The Document is mocked
// once, in beforeEach, with a factory that reads this. A second vi.doMock of the same path from
// inside a test raced with the first (registration is asynchronous), so a test sometimes got the
// built-in Document.
let currentDocument: any
const mockDocument = (Document: any) => {
    currentDocument = Document
}

// Documents whose PPR shell can't be used; the classic render (pprShell unset) is a normal page.
const shellDocument = (shell: (props: any) => any) => (props: any) =>
    props.pprShell
        ? shell(props)
        : React.createElement(
              "html",
              null,
              React.createElement("head", null),
              React.createElement("body", null, props.jsx)
          )
// [label, shell document, expected log, settle ms]. The prerender is aborted after
// PPR_PRERENDER_SETTLE_MS, and an abort before it finishes counts as postponed, so the
// "nothing postponed" case gets time to finish on a slow machine.
const SHELL_DOCUMENTS: [string, (props: any) => any, string, number][] = [
    [
        "the Document throws while the shell is prerendered",
        () => {
            throw new Error("shell document exploded")
        },
        "shell document exploded",
        50,
    ],
    [
        "the Document leaves the app out (nothing is postponed)",
        () =>
            React.createElement("html", null, React.createElement("head", null), React.createElement("body")),
        "nothing was postponed",
        2000,
    ],
    [
        "the shell has no #app",
        (props: any) =>
            React.createElement(
                "html",
                null,
                React.createElement("head", null),
                React.createElement(
                    "body",
                    null,
                    React.createElement("section", null, props.jsx.props.children)
                )
            ),
        "shell is incomplete",
        50,
    ],
]

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
        // Like Express: req.query is parsed from the URL, so it can't disagree with the
        // originalUrl the router and the route-data keys use.
        query: Object.fromEntries(new URLSearchParams(url.split("?")[1] || "")),
        cookies,
        headers: { "user-agent": userAgent },
        get(name: string) {
            return this.headers[name.toLowerCase()]
        },
    }
    return { req, res }
}

async function load() {
    const handlerModule: any = await import("../../src/server/renderer/handler.jsx")
    const handler = handlerModule.default
    const get = async (url: string, opts: any = {}) => {
        const { req, res } = makeReqRes(url, opts)
        if (opts.nonce) res.locals.cspNonce = opts.nonce
        await handler(req, res)
        await res.waitForEnd()
        return { html: res.getHtml() as string, mode: res.headers["x-rendering-mode"], res }
    }
    return Object.assign(get, { handlerModule })
}

// At runtime process.env is the plain object built from config.json (booleans stay booleans).
let realEnv: NodeJS.ProcessEnv
beforeEach(() => {
    realEnv = process.env
    process.env = { ...realEnv, src_path: process.cwd(), BUILD_OUTPUT_PATH: "build", APPLICATION: "test" }
    currentDocument = undefined
    vi.doMock(TEMPLATE_DOC, () => ({ default: currentDocument }))
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
        const page = await get("/ppr?late=", { cookies: USER_A })
        expect(page.html).toContain("user:<!-- -->user-aaaaaaaaaaaa")
        expect(page.html).toContain("document.cookie=")
        expect(page.html).toContain("late=1")
    })

    it("keeps shells for nonce and no-nonce requests apart", async () => {
        const get = await load()
        const plain = await get("/ppr", { cookies: USER_A })
        const withNonce = await get("/ppr", { cookies: USER_B, nonce: "nonce-one" })
        const plainAgain = await get("/ppr", { cookies: USER_A })
        expect(plain.mode).toBe("ppr-miss")
        // A shell built without a nonce has no placeholder, so reusing it would drop the nonce.
        expect(withNonce.mode).toBe("ppr-miss")
        expect(withNonce.html).toContain('nonce="nonce-one"')
        expect(plainAgain.mode).toBe("ppr-hit")
        expect(plainAgain.html).not.toContain("nonce=")
    })

    it("rebuilds the shell on every request in development", async () => {
        ;(process.env as any).NODE_ENV = "development"
        const get = await load()
        expect((await get("/ppr", { cookies: USER_A })).mode).toBe("ppr-miss")
        expect((await get("/ppr", { cookies: USER_B })).mode).toBe("ppr-miss")
    })

    it("flushes the shell when the response supports flush()", async () => {
        const handler = (await load()).handlerModule.default
        const { req, res } = makeReqRes("/ppr", { cookies: USER_A })
        res.flush = vi.fn()
        await handler(req, res)
        await res.waitForEnd()
        expect(res.flush).toHaveBeenCalled()
        expect(res.getHtml()).toContain("user:<!-- -->user-aaaaaaaaaaaa")
    })

    it("stops resuming when the client disconnects", async () => {
        const handler = (await load()).handlerModule.default
        const { req, res } = makeReqRes("/ppr?slow=", { cookies: USER_A }) // route data takes 100 ms
        const handled = handler(req, res)
        await vi.waitFor(() => expect(res.getHtml()).toContain("skeleton"))
        res.destroy()
        await handled
        await res.waitForEnd()
        expect(res.getHtml()).not.toContain("user-aaaaaaaaaaaa")
    })

    it.each(SHELL_DOCUMENTS)(
        "serves the classic render when %s, and does not retry the shell at once",
        async (_label, shell, logged, settleMs) => {
            ;(process.env as any).PPR_PRERENDER_SETTLE_MS = settleMs
            mockDocument(shellDocument(shell))
            const get = await load()
            const first = await get("/ppr", { cookies: USER_A })
            const second = await get("/ppr", { cookies: USER_B })
            expect(first.mode).toBeUndefined()
            expect(first.html).toContain("user:<!-- -->user-aaaaaaaaaaaa")
            expect(second.mode).toBeUndefined()
            const messages = [...(console.warn as any).mock.calls, ...(console.error as any).mock.calls]
                .flat()
                .map(String)
            expect(messages.some((m) => m.includes(logged))).toBe(true)
        }
    )

    it.each([
        ["a PPR route, after the shell went out", "/ppr", "ppr-miss"],
        ["the classic path", "/", undefined],
    ])("renders a 404 when serverDataFetcher itself throws on %s", async (_label, url, mode) => {
        vi.doMock(ROUTER_DATA, async (importOriginal) => ({
            ...(await importOriginal<object>()),
            serverDataFetcher: async () => {
                throw new Error("data layer down")
            },
        }))
        const onFetcherError = vi.fn()
        mockHooks({ onFetcherError })
        const get = await load()
        const page = await get(url, { cookies: USER_A })
        expect(page.mode).toBe(mode)
        expect(onFetcherError).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ message: "data layer down" }) })
        )
        if (mode) expect(page.html).toContain("window.__STATUS_CODE__=404")
        else expect(page.res.statusCode).toBe(404)
        vi.doUnmock(ROUTER_DATA)
    })

    it("stops when beforePPRFlush sends the response itself", async () => {
        mockHooks({ beforePPRFlush: ({ res }: any) => res.end("redirecting") })
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A })
        expect(page.html).toBe("redirecting")
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
        const page = await get("/ppr?slow=", { cookies: USER_A })
        expect(page.mode).toBe("ppr-miss")
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("timed out"))
        expect(page.html).not.toContain("user:<!-- -->user-aaaaaaaaaaaa")
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
        mockDocument(leakyDocument)
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
            get("/ppr?k=one", { cookies: USER_A }),
            get("/ppr?k=two", { cookies: USER_B }),
        ])
        expect([a.mode, b.mode].sort()).toEqual(["ppr-miss", undefined].sort())
    })

    it("keeps overlapping requests apart: each response has only its own user and split() widgets", async () => {
        const { userWidgetKey } = await import("./fixtures/template/src/js/routes/index.jsx")
        const get = await load()
        // Warm the shell so every overlapping request below resumes from the cache.
        expect((await get("/ppr-split", { cookies: { user: "user-warmup-000000" } })).mode).toBe("ppr-miss")

        const users = ["user-cccccccccccc", "user-dddddddddddd", "user-eeeeeeeeeeee", "user-ffffffffffff"]
        // Half the requests wait 100 ms for their data, so their resumes interleave with the others.
        const pages = await Promise.all(
            users.map((user, i) => get(i % 2 ? "/ppr-split?slow=" : "/ppr-split", { cookies: { user } }))
        )

        pages.forEach((page, i) => {
            const own = users[i]
            expect(page.mode).toBe("ppr-hit")
            expect(page.html).toContain(`user:<!-- -->${own}`)
            expect(page.html).toContain(`widget:<!-- -->${own}`)
            const rendered = page.html.match(/__SSR_RENDERED_COMPONENTS__=new Set\((.*?)\);/)
            expect(JSON.parse(rendered![1])).toEqual([userWidgetKey(own)])
            for (const other of users.filter((u) => u !== own)) {
                expect(page.html).not.toContain(other)
            }
        })
    })
})

describe("SSR handler — React without the PPR resume APIs", () => {
    it("renders PPR routes on the classic path and logs one error (React < 19.2)", async () => {
        ;(process.env as any).PPR_ENABLE = true
        vi.doMock("react-dom/server", async (importOriginal) => ({
            ...(await importOriginal<object>()),
            resumeToPipeableStream: undefined,
        }))
        const get = await load()
        const first = await get("/ppr", { cookies: USER_A })
        const second = await get("/ppr", { cookies: USER_B })
        expect(first.mode).toBeUndefined()
        expect(first.html).toContain("user:<!-- -->user-aaaaaaaaaaaa")
        expect(second.html).toContain("user:<!-- -->user-bbbbbbbbbbbb")
        const logged = (console.error as any).mock.calls.filter((c: any[]) =>
            String(c[0]).includes("needs React 19.2")
        )
        expect(logged).toHaveLength(1)
        vi.doUnmock("react-dom/server")
    })
})

describe("SSR handler — request paths that are not valid URLs", () => {
    // Express accepts these; scanners send them often. They must render like any other path.
    it.each(["//", "//[x", "//[x?y=1"])("renders %s without reporting an error", async (url) => {
        ;(process.env as any).PPR_ENABLE = true
        const onFetcherError = vi.fn()
        const onAppServerSideError = vi.fn()
        const onRequestError = vi.fn()
        mockHooks({ onFetcherError, onAppServerSideError, onRequestError })
        const get = await load()
        const page = await get(url)
        expect(page.res.statusCode).not.toBe(500)
        expect(page.html).toContain("</html>")
        expect(onFetcherError).not.toHaveBeenCalled()
        expect(onAppServerSideError).not.toHaveBeenCalled()
        expect(onRequestError).not.toHaveBeenCalled()
    })
})

describe("SSR handler — static cache guards", () => {
    it("does not cache a static page that contains a request cookie value", async () => {
        mockDocument(leakyDocument)
        const get = await load()
        const first = await get("/static", { cookies: USER_A })
        const second = await get("/static", { cookies: USER_B })
        expect(first.mode).toBe("static-cache-miss")
        expect(second.mode).toBe("static-cache-miss")
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("page contains request cookie values")
        )
    })

    it("clearStaticPageCache drops cached pages", async () => {
        const get = await load()
        const { clearStaticPageCache } = get.handlerModule
        await get("/static")
        expect((await get("/static")).mode).toBe("static-cache-hit")
        clearStaticPageCache()
        expect((await get("/static")).mode).toBe("static-cache-miss")
    })

    it("answers 500 when a static page fails to render", async () => {
        const get = await load()
        const page = await get("/static-error")
        expect(page.res.statusCode).toBe(500)
    })

    it("renders fresh when App.serverSideFunction sets a CSP nonce", async () => {
        const AppModule: any = await import("./fixtures/template/src/js/containers/App/index.jsx")
        const get = await load()
        await get("/static") // cache the page
        vi.spyOn(AppModule.default, "serverSideFunction").mockImplementationOnce(async ({ res }: any) => {
            res.locals.cspNonce = "late-nonce"
        })
        const page = await get("/static")
        expect(page.mode).toBeUndefined()
        expect(page.html).toContain("static page")
    })

    it("does not cache the page rendered after App.serverSideFunction throws", async () => {
        const AppModule: any = await import("./fixtures/template/src/js/containers/App/index.jsx")
        const get = await load()
        vi.spyOn(AppModule.default, "serverSideFunction").mockRejectedValueOnce(new Error("boom"))
        const failed = await get("/static")
        const next = await get("/static")
        expect(failed.mode).toBeUndefined()
        expect(next.mode).toBe("static-cache-miss")
    })

    it("renders a cached static page again once it is older than STATIC_PAGE_CACHE_TTL_MS", async () => {
        ;(process.env as any).STATIC_PAGE_CACHE_TTL_MS = 20
        const get = await load()
        expect((await get("/static")).mode).toBe("static-cache-miss")
        expect((await get("/static")).mode).toBe("static-cache-hit")
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect((await get("/static")).mode).toBe("static-cache-miss")
        expect((await get("/static")).mode).toBe("static-cache-hit")
    })

    it("does not cache a static page larger than STATIC_PAGE_CACHE_MAX_BYTES", async () => {
        ;(process.env as any).STATIC_PAGE_CACHE_MAX_BYTES = 10
        const get = await load()
        expect((await get("/static")).mode).toBe("static-cache-miss")
        expect((await get("/static")).mode).toBe("static-cache-miss")
    })

    it("renders fresh when the response carries a CSP nonce", async () => {
        const get = await load()
        const page = await get("/static", { nonce: "n" })
        expect(page.mode).toBeUndefined()
        expect(page.html).toContain("static page")
    })
})

describe("SSR handler — PPR and static routes with CSP_NONCE_ENABLE and runInParallel", () => {
    beforeEach(() => {
        ;(process.env as any).PPR_ENABLE = true
    })

    const parallelWork = async (work: () => Promise<unknown>) => {
        const AppModule: any = await import("./fixtures/template/src/js/containers/App/index.jsx")
        return vi
            .spyOn(AppModule.default, "serverSideFunction")
            .mockImplementation(async ({ runInParallel }: any) => runInParallel(work()))
    }

    it("stamps each PPR response's generated nonce on every script, on a miss and on a hit", async () => {
        ;(process.env as any).CSP_NONCE_ENABLE = true
        // An entry chunk, so the shell's <head> has a script and a modulepreload of its own.
        vi.doMock("../../src/server/manifestCache.js", () => ({
            getManifest: () => ({}),
            getAssetManifest: () => ({ essential: { main: { file: "main.abc.js" } } }),
            getIntegrityManifest: () => ({}),
        }))
        const get = await load()
        const first = await get("/ppr", { cookies: USER_A })
        const second = await get("/ppr", { cookies: USER_B })
        expect([first.mode, second.mode]).toEqual(["ppr-miss", "ppr-hit"])
        const nonces = [first, second].map((page) => page.res.locals.cspNonce)
        expect(nonces[0]).not.toBe(nonces[1])
        for (const [i, page] of [first, second].entries()) {
            const scripts = page.html.match(/<script\b[^>]*>/gi) || []
            expect(scripts.length).toBeGreaterThan(0)
            for (const tag of scripts) expect(tag).toContain(`nonce="${nonces[i]}"`)
            const head = page.html.slice(0, page.html.indexOf("</head>"))
            for (const tag of head.match(/<(script|link rel="modulepreload")\b[^>]*main\.abc\.js[^>]*>/g) || ["none"])
                expect(tag).toContain(`nonce="${nonces[i]}"`)
            expect(head.match(/main\.abc\.js/g)).toHaveLength(2)
        }
        vi.doUnmock("../../src/server/manifestCache.js")
    })

    it("finishes a PPR request only after the work passed to runInParallel settles", async () => {
        let release!: () => void
        const gate = new Promise<void>((resolve) => (release = resolve))
        await parallelWork(() => gate)
        const get = await load()
        let ended = false
        const page = get("/ppr", { cookies: USER_A }).then((p) => ((ended = true), p))
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(ended).toBe(false)
        release()
        expect((await page).mode).toBe("ppr-miss")
    })

    it("reports a runInParallel failure on a PPR route through onAppServerSideError", async () => {
        const onAppServerSideError = vi.fn()
        mockHooks({ onAppServerSideError })
        await parallelWork(() => Promise.reject(Object.assign(new Error("parallel"), { status_code: 502 })))
        const get = await load()
        const page = await get("/ppr", { cookies: USER_A })
        expect(page.mode).toBe("ppr-miss")
        expect(onAppServerSideError).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ message: "parallel" }) })
        )
        expect(page.html).toContain("window.__STATUS_CODE__=502")
    })

    it("does not replay a cached static page when runInParallel work fails", async () => {
        const onAppServerSideError = vi.fn()
        mockHooks({ onAppServerSideError })
        const spy = await parallelWork(() => Promise.resolve())
        const get = await load()
        expect((await get("/static")).mode).toBe("static-cache-miss")
        expect((await get("/static")).mode).toBe("static-cache-hit")
        spy.mockImplementation(async ({ runInParallel }: any) =>
            runInParallel(Promise.reject(new Error("parallel")))
        )
        const page = await get("/static")
        expect(page.mode).toBeUndefined()
        expect(onAppServerSideError).toHaveBeenCalledTimes(1)
    })
})
