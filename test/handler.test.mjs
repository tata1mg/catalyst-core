// Handler tests for deferred data: the real SSR handler behind express + compression(), with the
// fixture app in test/fixtures/template. npm run test:handler
import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import zlib from "node:zlib"
import vm from "node:vm"
import { fileURLToPath } from "node:url"
import express from "express"
import compression from "compression"

process.env.src_path = fileURLToPath(new URL("./fixtures/template", import.meta.url))
process.env.PUBLIC_STATIC_ASSET_URL = ""
process.env.PUBLIC_STATIC_ASSET_PATH = ""
process.env.IS_DEV_COMMAND = "false"
process.env.NODE_ENV = "test"
process.env.DEFER_TIMEOUT_MS = "400"

const T = (globalThis.__T = { calls: [], hooks: {}, warnings: [] })
global.logger = { info() {}, error() {}, warn: (message) => T.warnings.push(String(message)) }
const { default: handler } = await import("../src/server/renderer/handler.jsx")

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const NEVER = new Promise(() => {})
const quietConsole = { error: console.error, warn: console.warn }

let server
let port
const handled = []
before(async () => {
    console.error = () => {}
    console.warn = () => {}
    const app = express()
    app.use((req, res, next) => {
        if (req.headers["x-nonce"]) res.locals.cspNonce = req.headers["x-nonce"]
        next()
    })
    app.use(compression())
    app.use("*", async (req, res) => {
        await handler(req, res)
        handled.push(req.originalUrl)
    })
    await new Promise((resolve) => {
        server = app.listen(0, resolve)
    })
    port = server.address().port
})
after(() => {
    console.error = quietConsole.error
    console.warn = quietConsole.warn
    server.close()
})
beforeEach(() => {
    Object.assign(T, { calls: [], hooks: {}, warnings: [], blocking: false, renderMode: undefined })
    Object.assign(T, { throwInOrders: false, throwInShell: false, throwInBoundary: false, shellPad: "" })
    Object.assign(T, { renders: 0, shellWait: null })
    handled.length = 0
})

// GET with gzip; records when each decoded piece arrived.
const get = (path, { headers = {}, abortWhen, timeout = 3000 } = {}) =>
    new Promise((resolve) => {
        const t0 = Date.now()
        const chunks = []
        const text = () => chunks.map((c) => c.s).join("")
        const req = http.get({ port, path, headers: { "accept-encoding": "gzip", ...headers } }, (res) => {
            const body =
                res.headers["content-encoding"] === "gzip"
                    ? res.pipe(zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH }))
                    : res
            body.on("data", (c) => {
                chunks.push({ t: Date.now() - t0, s: c.toString() })
                if (abortWhen?.(text())) {
                    req.destroy()
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        chunks,
                        html: text(),
                        aborted: true,
                    })
                }
            })
            body.on("end", () =>
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    chunks,
                    html: text(),
                    ms: Date.now() - t0,
                })
            )
            body.on("error", () => {})
        })
        req.on("error", () => {})
        req.setTimeout(timeout, () => {
            req.destroy()
            resolve({ hung: true, chunks, html: text() })
        })
    })

// When `needle` was first readable by the client.
const arrivedAt = (response, needle) => {
    let text = ""
    for (const chunk of response.chunks) {
        text += chunk.s
        if (text.includes(needle)) return chunk.t
    }
    return -1
}

// Runs the page's own state scripts (not React's DOM runtime) in document order.
const clientState = (html) => {
    const context = vm.createContext({ window: { location: { replace() {}, assign() {} } } })
    for (const [, js] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
        if (/__INITIAL_STATE__|__CATALYST_DEFERRED/.test(js)) vm.runInContext(js, context)
    }
    return JSON.parse(JSON.stringify(context.window.__INITIAL_STATE__ ?? null))
}

const deferOrders =
    (ms, list, extra = {}) =>
    (_props, { store, defer }) => {
        defer(
            "orders",
            delay(ms).then(() => store.dispatch({ type: "orders", list })),
            { stateKeys: ["orders"], ...extra }
        )
        return {}
    }
const hookCalls = (name) => T.calls.filter((call) => call[0] === name)

test("a page without defer() is served as before: no streaming header, no reveal script", async () => {
    T.fetcher = () => ({})
    const r = await get("/orders")
    assert.equal(r.status, 200)
    assert.equal(r.headers["x-accel-buffering"], undefined)
    assert.ok(!r.html.includes('"$RT"') && r.html.includes("orders:0"))
})

test("the shell goes out through gzip before the deferred work, then the section with its state", async () => {
    T.fetcher = deferOrders(300, [1, 2])
    const r = await get("/orders", { headers: { "x-nonce": "N1" } })
    assert.equal(r.status, 200)
    assert.equal(r.headers["content-encoding"], "gzip")
    assert.equal(r.headers["x-accel-buffering"], "no")
    assert.ok(arrivedAt(r, "loading") >= 0 && arrivedAt(r, "loading") < 200, "shell before the work settles")
    assert.ok(arrivedAt(r, "orders:2") >= 280, "section after the work")
    assert.ok(
        r.html.includes('<head><script nonce="N1">Object.defineProperty(window,"$RT"'),
        "reveal script first in head"
    )
    assert.ok(
        r.html.includes('<script nonce="N1">(window.__CATALYST_DEFERRED__'),
        "section script has the nonce"
    )
    assert.ok(/<script nonce="N1">\$R[CB]/.test(r.html), "React's reveal script has the nonce")
    assert.deepEqual(clientState(r.html).orders, { list: [1, 2] })
    assert.deepEqual(hookCalls("onRenderError"), [])
})

test("a shell larger than compression()'s buffer is flushed in full before the deferred work", async () => {
    T.shellPad = "x".repeat(200 * 1024)
    T.fetcher = deferOrders(300, [1])
    const r = await get("/orders")
    const shellAt = arrivedAt(r, "loading")
    assert.ok(shellAt >= 0 && shellAt < 200, `shell end readable at ${shellAt} ms`)
    assert.ok(arrivedAt(r, "orders:1") >= 280, "section after the work")
})

test("deferred work that never settles: the response ends at DEFER_TIMEOUT_MS and the section is reported", async () => {
    T.fetcher = (_props, { defer }) => {
        defer("orders", NEVER, { stateKeys: ["orders"] })
        return {}
    }
    const r = await get("/orders")
    assert.ok(!r.hung && r.ms < 1200, "response ended")
    assert.ok(/\$RX|\$!/.test(r.html), "the section is handed to the client")
    assert.ok(r.html.includes("</html>"))
    assert.deepEqual(hookCalls("onDeferredError"), [["onDeferredError", "Deferred data timed out"]])
    assert.deepEqual(hookCalls("onRenderError"), [])
})

test("a render error inside the section after the shell ends the response, reported once", async () => {
    T.throwInOrders = true
    T.fetcher = deferOrders(100, [1])
    const r = await get("/orders")
    assert.ok(!r.hung, "response ended")
    assert.equal(r.status, 200)
    assert.ok(r.ms < 350, "ended by React, not by the timeout")
    assert.deepEqual(hookCalls("onRenderError"), [["onRenderError", "orders render bug"]])
})

test("a render error before the shell takes the error path instead of a 200 with a fallback", async () => {
    T.throwInBoundary = true
    T.fetcher = () => ({})
    T.hooks.onFetcherError = ({ res }) => res.status(500).end("error page")
    const r = await get("/orders")
    assert.equal(r.status, 500)
    assert.equal(r.html, "error page")
    assert.deepEqual(hookCalls("onFetcherError"), [["onFetcherError", "widget render bug"]])
})

test("defer() after the serverFetcher returned is ignored with a warning and does not hold the response", async () => {
    T.fetcher = (_props, { defer }) => {
        setTimeout(() => defer("orders", NEVER, { stateKeys: ["orders"] }), 30)
        return {}
    }
    const r = await get("/orders")
    assert.ok(!r.hung && r.ms < 300, "not held by the late work")
    assert.equal(r.headers["x-accel-buffering"], undefined)
    assert.ok(r.html.includes("orders:0"), "the section rendered without it")
    await delay(60)
    assert.ok(T.warnings.some((w) => w.includes("after rendering started")))
})

test("a client that disconnects stops the render", async () => {
    T.fetcher = (_props, { defer }) => {
        defer("orders", NEVER, { stateKeys: ["orders"] })
        return {}
    }
    const r = await get("/orders", { abortWhen: (s) => s.includes("loading") })
    assert.ok(r.aborted)
    await delay(150)
    assert.equal(handled.length, 1, "handler returned before the 400 ms timeout")
    assert.deepEqual(hookCalls("onRenderError"), [])
})

test("blocking request: a failed deferred takes the fetcher error path with its status, reported once", async () => {
    T.blocking = true
    T.fetcher = (_props, { defer }) => {
        const error = Object.assign(new Error("upstream"), { status_code: 503 })
        defer(
            "orders",
            delay(20).then(() => Promise.reject(error)),
            { stateKeys: ["orders"] }
        )
        return {}
    }
    const r = await get("/orders")
    assert.equal(r.status, 503)
    assert.equal(r.headers["x-accel-buffering"], undefined)
    assert.ok(!r.html.includes("__CATALYST_DEFERRED__"))
    assert.deepEqual(
        T.calls.filter(([name]) => name === "onFetcherError" || name === "onDeferredError"),
        [["onFetcherError", "upstream"]]
    )
})

test("blocking request: a failure mapped to a redirect is a real one, with its status", async () => {
    T.blocking = true
    T.fetcher = (_props, { defer }) => {
        defer("orders", Promise.reject(new Error("moved")), {
            stateKeys: ["orders"],
            onError: () => ({ redirect: "/new", status: 301 }),
        })
        return {}
    }
    const moved = await get("/orders")
    assert.equal(moved.status, 301)
    assert.equal(moved.headers.location, "/new")

    T.fetcher = (_props, { defer }) => {
        defer("orders", Promise.reject(new Error("401")), { stateKeys: ["orders"], onError: () => "/login" })
        return {}
    }
    const login = await get("/orders")
    assert.equal(login.status, 302)
    assert.equal(login.headers.location, "/login")
})

test("blocking request: the wait for deferred work is bounded by DEFER_TIMEOUT_MS (504)", async () => {
    T.blocking = true
    T.fetcher = (_props, { defer }) => {
        defer("orders", NEVER, { stateKeys: ["orders"] })
        return {}
    }
    T.hooks.onFetcherError = ({ res, error }) => res.status(error.status_code).end("timed out")
    const r = await get("/orders")
    assert.ok(!r.hung && r.ms < 1200)
    assert.equal(r.status, 504)
})

test("blocking request: success renders inline, with no script and no streaming header", async () => {
    T.blocking = true
    T.fetcher = deferOrders(50, [1, 2, 3])
    const r = await get("/orders")
    assert.equal(r.status, 200)
    assert.ok(r.html.includes("orders:3") && !r.html.includes("loading"))
    assert.ok(!r.html.includes("__CATALYST_DEFERRED__"))
    assert.equal(r.headers["x-accel-buffering"], undefined)
    assert.deepEqual(clientState(r.html).orders, { list: [1, 2, 3] })
})

test("work that settled before the render is written in the shell and merged by the state script", async () => {
    T.fetcher = (_props, { store, defer }) => {
        const work = Promise.resolve().then(() => store.dispatch({ type: "orders", list: [9] }))
        defer("orders", work, { stateKeys: ["orders"] })
        return work.then(() => ({}))
    }
    const r = await get("/orders")
    assert.ok(r.html.includes("orders:1") && !r.html.includes("loading"))
    assert.deepEqual(clientState(r.html).orders, { list: [9] })
})

test("a page that fails to render is rendered once, and gets a bare 500 when no hook answers", async () => {
    T.throwInBoundary = true
    T.fetcher = () => ({})
    const r = await get("/orders")
    assert.ok(!r.hung, "response ended")
    assert.equal(r.status, 500)
    assert.equal(T.renders, 1, "not rendered again after it failed")
    assert.deepEqual(
        T.calls.map(([name]) => name).filter((name) => name !== "onRenderError"),
        ["onFetcherError", "onAppServerSideError", "onRequestError"]
    )
})

test("a shell that waits longer than DEFER_TIMEOUT_MS is not cut by the deferred timer", async () => {
    T.shellWait = delay(600)
    T.fetcher = deferOrders(100, [1])
    const r = await get("/orders")
    assert.ok(!r.hung)
    assert.equal(r.status, 200)
    assert.ok(r.html.includes("orders:1"))
    assert.deepEqual(hookCalls("onDeferredError"), [])
})

test("PPR: a resumed app larger than compression()'s buffer arrives before the deferred work", async () => {
    process.env.PPR_ENABLE = "true"
    try {
        T.renderMode = "ppr"
        T.shellPad = "x".repeat(200 * 1024)
        T.fetcher = deferOrders(300, [1])
        await get("/orders") // builds the shell
        const r = await get("/orders")
        assert.match(String(r.headers["x-rendering-mode"]), /^ppr-/)
        assert.equal(r.headers["x-accel-buffering"], "no")
        const appAt = arrivedAt(r, "loading")
        assert.ok(appAt >= 0 && appAt < 200, `resumed app readable at ${appAt} ms`)
        assert.ok(arrivedAt(r, "orders:1") >= 280, "section after the work")
    } finally {
        delete process.env.PPR_ENABLE
    }
})

test("PPR: defer() after the serverFetcher returned is ignored with a warning", async () => {
    process.env.PPR_ENABLE = "true"
    try {
        T.renderMode = "ppr"
        T.fetcher = (_props, { defer }) => {
            setTimeout(() => defer("orders", NEVER, { stateKeys: ["orders"] }), 30)
            return {}
        }
        await get("/orders")
        const r = await get("/orders")
        await delay(60)
        assert.match(String(r.headers["x-rendering-mode"]), /^ppr-/)
        assert.ok(!r.hung && r.ms < 300, "not held by the late work")
        assert.ok(T.warnings.some((w) => w.includes("after rendering started")))
    } finally {
        delete process.env.PPR_ENABLE
    }
})

test("static: the page renders complete and is cached", async () => {
    T.renderMode = "static"
    T.fetcher = deferOrders(50, [1, 2])
    const first = await get("/orders?static=complete")
    assert.equal(first.headers["x-rendering-mode"], "static-cache-miss")
    assert.ok(first.html.includes("orders:2") && !first.html.includes("loading"))
    const second = await get("/orders?static=complete")
    assert.equal(second.headers["x-rendering-mode"], "static-cache-hit")
    assert.ok(second.html.includes("orders:2"))
})

test("static: a client that leaves during the wait does not leave an incomplete page in the cache", async () => {
    T.renderMode = "static"
    T.fetcher = deferOrders(300, [1, 2])
    const gone = await get("/orders?static=gone", { timeout: 60 })
    assert.ok(gone.hung, "client gave up")
    await delay(400)
    const next = await get("/orders?static=gone")
    assert.equal(next.headers["x-rendering-mode"], "static-cache-miss")
    assert.ok(next.html.includes("orders:2"))
})

test("a bot and DEFER_STREAMING_ENABLE=false get the whole page in the first response", async () => {
    T.fetcher = deferOrders(50, [1, 2])
    const bot = await get("/orders", {
        headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    })
    assert.ok(bot.html.includes("orders:2") && !bot.html.includes("loading"))
    assert.ok(!bot.html.includes("__CATALYST_DEFERRED__"))
    process.env.DEFER_STREAMING_ENABLE = "false"
    try {
        const off = await get("/orders")
        assert.ok(off.html.includes("orders:2") && !off.html.includes("loading"))
        assert.equal(off.headers["x-accel-buffering"], undefined)
    } finally {
        delete process.env.DEFER_STREAMING_ENABLE
    }
})

test("blocking request: a client that leaves ends the wait at once", async () => {
    T.blocking = true
    T.fetcher = (_props, { defer }) => {
        defer("orders", NEVER, { stateKeys: ["orders"] })
        return {}
    }
    const r = await get("/orders", { timeout: 60 })
    assert.ok(r.hung, "client gave up")
    await delay(150)
    assert.equal(handled.length, 1, "handler returned before the 400 ms timeout")
})

test("blocking request: a fetcher error is answered at once, and a later deferred failure is still reported", async () => {
    T.blocking = true
    T.fetcher = (_props, { defer }) => {
        defer(
            "orders",
            delay(30).then(() => Promise.reject(new Error("late failure"))),
            { stateKeys: ["orders"] }
        )
        throw Object.assign(new Error("fetch failed"), { status_code: 500 })
    }
    T.hooks.onFetcherError = ({ res, error }) => res.status(error.status_code || 500).end("err")
    const r = await get("/orders")
    assert.ok(!r.hung && r.ms < 250, `answered in ${r.ms} ms`)
    await delay(80)
    assert.deepEqual(hookCalls("onDeferredError"), [["onDeferredError", "late failure"]])
})

test("blocking request: with two failures, the first takes the fetcher error path and the other is reported", async () => {
    T.blocking = true
    T.fetcher = (_props, { defer }) => {
        defer("orders", Promise.reject(new Error("first")), { stateKeys: ["orders"] })
        defer(
            "extra",
            delay(10).then(() => Promise.reject(new Error("second"))),
            { stateKeys: ["extra"] }
        )
        return {}
    }
    await get("/orders")
    assert.deepEqual(
        T.calls.filter(([name]) => name === "onFetcherError" || name === "onDeferredError"),
        [
            ["onDeferredError", "second"],
            ["onFetcherError", "first"],
        ]
    )
})

test("a client gone before the render: the handler returns without rendering", async () => {
    T.fetcher = async (_props, { defer }) => {
        defer("orders", NEVER, { stateKeys: ["orders"] })
        await delay(120)
        return {}
    }
    const r = await get("/orders", { timeout: 40 })
    assert.ok(r.hung)
    await delay(250)
    assert.equal(handled.length, 1, "handler returned before the 400 ms timeout")
    assert.equal(T.renders, 0)
})

test("an onRenderError hook that ends the response stops the render, with one warning", async () => {
    T.throwInOrders = true
    T.fetcher = deferOrders(30, [1])
    T.hooks.onRenderError = ({ res }) => res.end()
    const uncaught = []
    const onUncaught = (error) => uncaught.push(error.code || error.message)
    process.on("uncaughtException", onUncaught)
    try {
        const r = await get("/orders", { headers: { "accept-encoding": "identity" } })
        await delay(100)
        assert.ok(!r.hung)
        assert.equal(T.warnings.filter((w) => w.includes("onRenderError ended")).length, 1)
        assert.deepEqual(uncaught, [])
        assert.equal(handled.length, 1)
    } finally {
        process.off("uncaughtException", onUncaught)
    }
})

test("concurrent requests keep their own nonce and data", async () => {
    T.fetcher = (props, { store, defer }) => {
        const n = Number(props.req.query.n)
        defer(
            "orders",
            delay(50 * n).then(() => store.dispatch({ type: "orders", list: Array(n).fill(n) })),
            {
                stateKeys: ["orders"],
            }
        )
        return {}
    }
    const responses = await Promise.all(
        [1, 2, 3, 4].map((n) => get(`/orders?n=${n}`, { headers: { "x-nonce": `nonce${n}` } }))
    )
    responses.forEach((r, i) => {
        const n = i + 1
        assert.ok(r.html.includes(`orders:${n}`))
        assert.deepEqual(clientState(r.html).orders, { list: Array(n).fill(n) })
        const nonces = new Set(Array.from(r.html.matchAll(/nonce="([^"]+)"/g), (m) => m[1]))
        assert.deepEqual([...nonces], [`nonce${n}`])
    })
})
