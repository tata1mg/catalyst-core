import { Writable } from "node:stream"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// SSR handler — manifest → chunk → markup coverage (#348 follow-up).
//
// handler.test.ts proves the request lifecycle (200 / 404 / fetcher status,
// stream completion, error propagation) but runs with:
//   - the fixture's CustomDocument always present, so handler.jsx:242 always
//     short-circuits and the built-in Head/Body never render; and
//   - NODE_ENV unset, so manifestCache returns null and _collectAssets
//     builds a ChunkExtractor over {} / {} — every asset path executes with
//     empty inputs and asserts nothing.
//
// This file drives the other side: no CustomDocument (built-in document),
// a populated fake manifest so preloadRouteCss / addComponent resolve real
// chunks, real CSS files on disk so readCssFromDisk returns content, and a
// bot UA so the !isBot gates in Head.jsx / registerDeferredAssetsForRoute
// are exercised end-to-end in a rendered response.
//
// Deliberately NOT here: real split() + lazy + Suspense streaming (that is
// Split.server.test.jsx, #454) and browser behavior (Playwright, #412).
// The fixture WidgetPage self-registers with global.__CHUNK_EXTRACTOR__ the
// exact way Split.jsx:53-54 does on the server, so the deferred-asset
// plumbing downstream of that call is covered without pulling the whole
// split() machinery in.

const TEMPLATE_DOC = "@catalyst/template/server/document"
const MANIFEST_CACHE = "../../src/server/manifestCache.js"

// Fake build manifest. HomePage's __cacheKey → a critical chunk with CSS;
// WIDGET_CACHE_KEY → a deferred chunk with its own CSS (registered during
// render via addComponent). `file` has no leading "assets/" — the emitted
// URL is PUBLIC_STATIC_ASSET_URL + PUBLIC_STATIC_ASSET_PATH + file.
const FAKE_MANIFEST = {
    "src/js/routes/HomePage": { file: "home.abc123.js", css: ["home.abc123.css"] },
    "src/js/components/Widget": { file: "widget.def456.js", css: ["widget.def456.css"] },
}

function mockManifest() {
    vi.doMock(MANIFEST_CACHE, () => ({
        getManifest: () => FAKE_MANIFEST,
        getAssetManifest: () => ({ ssrTrue: {}, ssrFalse: {}, essential: {} }),
    }))
}

// A real Writable so renderToPipeableStream's Transform → res pipe works.
function makeReqRes(url = "/", userAgent = "test") {
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
        headers: { "user-agent": userAgent },
        get(name: string) {
            return this.headers[name.toLowerCase()]
        },
    }
    return { req, res }
}

let buildDir: string

beforeEach(() => {
    // A real build dir so readCssFromDisk (fs.readFileSync) returns content.
    // src_path + BUILD_OUTPUT_PATH is how handler.jsx:205 computes it.
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-assets-"))
    fs.writeFileSync(path.join(buildDir, "home.abc123.css"), ".home{color:red}")
    fs.writeFileSync(path.join(buildDir, "widget.def456.css"), ".widget{color:blue}")

    process.env.src_path = path.dirname(buildDir)
    process.env.BUILD_OUTPUT_PATH = path.basename(buildDir)
    process.env.APPLICATION = "test"
    process.env.IS_DEV_COMMAND = "false"
    process.env.PUBLIC_STATIC_ASSET_URL = "http://localhost"
    process.env.PUBLIC_STATIC_ASSET_PATH = "/assets/"
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock(TEMPLATE_DOC)
    vi.doUnmock(MANIFEST_CACHE)
    try {
        fs.rmSync(buildDir, { recursive: true, force: true })
    } catch {
        // best-effort cleanup
    }
    // ChunkExtractor's constructor sets this and nothing clears it; a leak
    // would let one test's extractor catch the next test's addComponent.
    delete (global as any).__CHUNK_EXTRACTOR__
    // extract.js keeps its deferred-route cache and CSS-body cache on
    // `process` — reset so cross-request-cache tests start clean and the
    // first render of a route never sees a prior run's deferred paths.
    delete (process as any).deferredAssetsByRoute
    delete (process as any).cssFileCache
})

describe("SSR handler — built-in document (no CustomDocument)", () => {
    it("renders the built-in Head/Body when the app exports no CustomDocument", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: undefined }))
        mockManifest()

        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes("/")

        await handler(req, res)
        await res.waitForEnd()

        const html = res.getHtml()
        // Built-in Head markers — never present when the fixture
        // CustomDocument (which renders <title>fixture</title> +
        // data-testid="doc-root") takes the branch.
        expect(html).toContain('<meta charSet="utf-8"')
        expect(html).toContain('<link rel="preconnect" href="http://localhost/assets/"')
        expect(html).not.toContain('data-testid="doc-root"')
        // Built-in Body marker.
        expect(html).toContain("window.__SAFE_AREA_INITIAL__")
        expect(res.isEnded()).toBe(true)
    })

    it("flags PREFLIGHT-021 and falls back to the built-in document when CustomDocument is not a function", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: { not: "a function" } }))
        mockManifest()

        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes("/")

        await handler(req, res)
        await res.waitForEnd()

        // validateCustomDocument -> handleError -> console.log (default
        // output mode), not console.error.
        const logged = (console.log as any).mock.calls.flat().join("\n")
        expect(logged).toContain("PREFLIGHT-021")

        // Fallback actually happened: built-in Head rendered, fixture
        // CustomDocument did not.
        const html = res.getHtml()
        expect(html).toContain('<meta charSet="utf-8"')
        expect(html).not.toContain('data-testid="doc-root"')
    })
})

describe("SSR handler — critical asset collection", () => {
    it("resolves the matched route's chunk from the manifest: inlines its CSS and emits its module script + modulepreload in <head>", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: undefined }))
        mockManifest()

        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes("/")

        await handler(req, res)
        await res.waitForEnd()

        const html = res.getHtml()
        const headEnd = html.indexOf("</head>")

        // Critical CSS inlined as <style> from disk.
        expect(html).toContain("<style>.home{color:red}</style>")
        expect(html.indexOf("<style>.home{color:red}</style>")).toBeLessThan(headEnd)

        // Critical JS as <script type="module"> + a modulepreload link, both
        // in <head>. URL = PUBLIC_STATIC_ASSET_URL + PUBLIC_STATIC_ASSET_PATH
        // + manifest file.
        const jsUrl = "http://localhost/assets/home.abc123.js"
        expect(html).toContain(`<script type="module" src="${jsUrl}">`)
        expect(html).toContain(`<link rel="modulepreload" href="${jsUrl}"`)
        expect(html.indexOf(`<script type="module" src="${jsUrl}">`)).toBeLessThan(headEnd)
    })

    it("suppresses module scripts and modulepreload links for a bot UA, but still inlines critical CSS", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: undefined }))
        mockManifest()

        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes(
            "/",
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        )

        await handler(req, res)
        await res.waitForEnd()

        const html = res.getHtml()
        expect(html).toContain("window.__CATALYST_IS_BOT__=true")
        // CSS is not JS — bots still get it inlined (no FOUC).
        expect(html).toContain("<style>.home{color:red}</style>")
        // !isBot gates in Head.jsx (jsScripts, criticalPreloadLinks).
        expect(html).not.toContain('<script type="module" src="http://localhost/assets/home.abc123.js">')
        expect(html).not.toContain('rel="modulepreload"')
    })
})

describe("SSR handler — deferred assets discovered during render", () => {
    it("serializes render-tracked component keys and flushes deferred CSS/JS after the document", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: undefined }))
        mockManifest()

        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes("/widget")

        await handler(req, res)
        await res.waitForEnd()

        const html = res.getHtml()
        const htmlEnd = html.indexOf("</html>")

        // WidgetPage called chunkExtractor.addComponent(WIDGET_CACHE_KEY)
        // during render (the Split.jsx server path). getRenderedComponentKeys
        // now reflects it.
        expect(html).toContain('window.__SSR_RENDERED_COMPONENTS__=new Set(["src/js/components/Widget"])')

        // Deferred chunk's CSS is flushed as a post-</html> <style> on the
        // first visit (not yet route-cached), and its JS as a module script.
        const deferredStyleIdx = html.indexOf("<style>.widget{color:blue}</style>")
        expect(deferredStyleIdx).toBeGreaterThan(htmlEnd)
        expect(html).toContain(
            '<script type="module" src="http://localhost/assets/widget.def456.js"></script>',
        )
        expect(html.indexOf('src="http://localhost/assets/widget.def456.js"')).toBeGreaterThan(htmlEnd)
    })

    it("inlines previously-deferred CSS in <head> on the second visit to the same route", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: undefined }))
        mockManifest()

        const { default: handler } = await import("../../src/server/renderer/handler.jsx")

        // First visit — deferred CSS learned, flushed after </html>.
        const first = makeReqRes("/widget")
        await handler(first.req, first.res)
        await first.res.waitForEnd()
        const firstHtml = first.res.getHtml()
        expect(firstHtml.indexOf("<style>.widget{color:blue}</style>")).toBeGreaterThan(
            firstHtml.indexOf("</html>"),
        )

        // Second visit — same route key. getCachedDeferredCssPathsForRoute
        // now returns widget.def456.css, so it is inlined in <head> via
        // deferredRouteInlineCss (Head.jsx:42) and NOT re-flushed after body
        // (registerDeferredAssetsForRoute reports it as already seen).
        const second = makeReqRes("/widget")
        await handler(second.req, second.res)
        await second.res.waitForEnd()
        const secondHtml = second.res.getHtml()

        const headEnd = secondHtml.indexOf("</head>")
        const htmlEnd = secondHtml.indexOf("</html>")
        const styleIdx = secondHtml.indexOf("<style>.widget{color:blue}</style>")
        expect(styleIdx).toBeGreaterThan(-1)
        expect(styleIdx).toBeLessThan(headEnd)
        // No second post-body <style> for the same CSS.
        expect(secondHtml.indexOf("<style>.widget{color:blue}</style>", htmlEnd)).toBe(-1)

        // Warm-cache modulepreload for the deferred JS learned last visit
        // (getDeferredPreloadScriptUrls -> deferredPreloadLinks, Head.jsx:33).
        const preloadIdx = secondHtml.indexOf(
            '<link rel="modulepreload" href="http://localhost/assets/widget.def456.js"',
        )
        expect(preloadIdx).toBeGreaterThan(-1)
        expect(preloadIdx).toBeLessThan(headEnd)
    })

    it("does not flush deferred JS after the document for a bot UA", async () => {
        vi.doMock(TEMPLATE_DOC, () => ({ default: undefined }))
        mockManifest()

        const { default: handler } = await import("../../src/server/renderer/handler.jsx")
        const { req, res } = makeReqRes(
            "/widget",
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        )

        await handler(req, res)
        await res.waitForEnd()

        const html = res.getHtml()
        const htmlEnd = html.indexOf("</html>")
        // Deferred CSS still flushed (bots get styles); deferred JS is gated
        // behind !isBot in the tail flush (handler.jsx:312) and skipped in
        // registerDeferredAssetsForRoute.
        expect(html.indexOf("<style>.widget{color:blue}</style>")).toBeGreaterThan(htmlEnd)
        expect(html).not.toContain("widget.def456.js")
    })
})
