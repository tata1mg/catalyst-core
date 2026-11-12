// Render tests for <Deferred> with React 19.2 (server streaming and PPR prerender/resume):
// npm run test:render
import { test } from "node:test"
import assert from "node:assert/strict"
import { Writable } from "node:stream"
import { createElement as h, Suspense } from "react"
import { renderToPipeableStream, renderToString, resumeToPipeableStream } from "react-dom/server"
import { prerenderToNodeStream } from "react-dom/static"
import { Deferred } from "../src/web-router/components/Deferred.jsx"
import { SsrRequestProvider } from "../src/web-router/components/SsrRequestContext.jsx"
import { PPRRenderProvider } from "../src/web-router/components/PPR.jsx"
import { createDeferredRegistry } from "../src/server/renderer/deferred.js"

const silent = { warn() {}, error() {} }
const SCRIPT = /<script[^>]*>[\s\S]*?<\/script>/g

// A page: the header renders at once, the orders wait for deferred work.
const makePage = () => {
    const state = { orders: { list: [] } }
    const Orders = () => h("ul", { id: "orders" }, `orders:${state.orders.list.length}`)
    const page = h(
        "main",
        null,
        h("header", null, "Header"),
        h(Deferred, { name: "orders", fallback: h("p", { id: "skeleton" }, "loading") }, h(Orders))
    )
    return { state, page, store: { getState: () => state } }
}

const sinkInto = (chunks, onFinish) =>
    new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString())
            cb()
        },
        final(cb) {
            onFinish()
            cb()
        },
    })

// Streams `element`; `afterShell` runs once the shell has been written. Resolves with the shell
// text and the whole output.
const stream = (element, { afterShell, nonce } = {}) =>
    new Promise((resolve, reject) => {
        const chunks = []
        let shell = null
        const sink = sinkInto(chunks, () =>
            resolve({ shell: shell ?? chunks.join(""), html: chunks.join("") })
        )
        const { pipe } = renderToPipeableStream(element, {
            nonce,
            onShellReady() {
                pipe(sink)
                setImmediate(() => {
                    shell = chunks.join("")
                    afterShell?.()
                })
            },
            onShellError: reject,
        })
    })

const withRegistry = (registry, page, nonce = "N0NCE") =>
    h(SsrRequestProvider, { value: { deferred: registry, nonce } }, page)

test("a deferred section streams after the shell, with its state script before its content", async () => {
    const { state, page, store } = makePage()
    const registry = createDeferredRegistry({ store, logger: silent })
    let finish
    registry.defer("orders", new Promise((resolve) => (finish = resolve)), { stateKeys: ["orders"] })

    const { shell, html } = await stream(withRegistry(registry, page), {
        nonce: "N0NCE",
        afterShell() {
            state.orders = { list: [1, 2] } // the work updates the store, then settles
            finish()
        },
    })

    assert.ok(shell.includes("Header") && shell.includes("loading"), "shell has the header and the fallback")
    assert.ok(!shell.includes("orders:"), "shell does not wait for the orders")
    const script = html.indexOf('<script nonce="N0NCE">(window.__CATALYST_DEFERRED__')
    assert.ok(script > shell.length - 1, "the section's script streams after the shell")
    assert.ok(
        html.includes('{\\"list\\":[1,2]}') && html.includes('s["orders"]=v'),
        "the script carries the state slice"
    )
    assert.ok(html.indexOf("orders:2") > script, "the content follows its script")
})

test("a section whose work already settled renders in the shell, without its fallback", async () => {
    const { state, page, store } = makePage()
    const registry = createDeferredRegistry({ store, logger: silent })
    state.orders = { list: [1] }
    registry.defer("orders", Promise.resolve(), { stateKeys: ["orders"] })
    await registry.settleAll()

    const { shell } = await stream(withRegistry(registry, page))
    assert.ok(!shell.includes("loading"))
    assert.ok(shell.includes("__CATALYST_DEFERRED__") && shell.includes("orders:1"))
})

test("a blocking request renders the content inline with no script", async () => {
    const { state, page, store } = makePage()
    const registry = createDeferredRegistry({ store, blocking: true, logger: silent })
    state.orders = { list: [1, 2, 3] }
    registry.defer("orders", Promise.resolve(), { stateKeys: ["orders"] })
    await registry.settleAll()

    const { shell, html } = await stream(withRegistry(registry, page))
    assert.ok(shell.includes("orders:3") && !shell.includes("loading"))
    assert.ok(!html.includes("__CATALYST_DEFERRED__"))
})

test("without a defer() for its name the section renders its children as they are", async () => {
    const { page, store } = makePage()
    const registry = createDeferredRegistry({ store, logger: silent })
    const { shell, html } = await stream(withRegistry(registry, page))
    assert.ok(shell.includes("orders:0") && !html.includes("<script"))
})

test("the client renders the same elements the server streamed, so hydration matches", async () => {
    const { state, page, store } = makePage()
    const registry = createDeferredRegistry({ store, logger: silent })
    state.orders = { list: [1] }
    registry.defer("orders", Promise.resolve(), { stateKeys: ["orders"] })
    await registry.settleAll()
    const server = renderToString(withRegistry(registry, page))

    globalThis.window = { __CATALYST_DEFERRED__: { orders: 1 } } // set by the server's script
    try {
        const client = renderToString(withRegistry(undefined, page))
        assert.equal(client.replace(SCRIPT, "<script></script>"), server.replace(SCRIPT, "<script></script>"))
        delete globalThis.window.__CATALYST_DEFERRED__
        const fresh = renderToString(withRegistry(undefined, page)) // a page the server did not stream
        assert.ok(!fresh.includes("<script"))
    } finally {
        delete globalThis.window
    }
})

test("sections with the same name at different Suspense depths both match the server", async () => {
    const { state, store } = makePage()
    const Orders = () => h("ul", null, `orders:${state.orders.list.length}`)
    const section = (fallback) => h(Deferred, { name: "orders", fallback: h("p", null, fallback) }, h(Orders))
    const page = h("main", null, section("a"), h(Suspense, { fallback: null }, h("div", null, section("b"))))
    const registry = createDeferredRegistry({ store, logger: silent })
    state.orders = { list: [1] }
    registry.defer("orders", Promise.resolve(), { stateKeys: ["orders"] })
    await registry.settleAll()
    const server = renderToString(withRegistry(registry, page))
    assert.equal(server.match(SCRIPT).length, 2)

    globalThis.window = { __CATALYST_DEFERRED__: { orders: 1 } }
    try {
        // The marker is not consumed by the first section, so the nested one still renders its script.
        const client = renderToString(withRegistry(undefined, page))
        assert.equal(client.replace(SCRIPT, "<script></script>"), server.replace(SCRIPT, "<script></script>"))
    } finally {
        delete globalThis.window
    }
})

test("the script carries the store as the section renders, not as it was when the work settled", async () => {
    const { state, page, store } = makePage()
    const registry = createDeferredRegistry({ store, logger: silent })
    registry.defer("orders", Promise.resolve(), { stateKeys: ["orders"] })
    await registry.settleAll()
    state.orders = { list: [1, 2, 3] } // written after the work settled, before the render
    const { shell } = await stream(withRegistry(registry, page))
    assert.ok(shell.includes("orders:3"))
    assert.ok(shell.includes('{\\"list\\":[1,2,3]}'), "the script matches the rendered HTML")
})

test("PPR: the section is postponed out of the shell and streams in on resume", async () => {
    const { state, page, store } = makePage()
    const tree = (phase, value) =>
        h(
            PPRRenderProvider,
            { value: { phase } },
            h(SsrRequestProvider, { value }, h("html", null, h("body", null, page)))
        )

    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error("shell complete")), 50)
    const { prelude, postponed } = await prerenderToNodeStream(tree("prerender", {}), {
        signal: controller.signal,
        onError() {},
    })
    const shellChunks = []
    for await (const chunk of prelude) shellChunks.push(chunk.toString())
    const shell = shellChunks.join("")
    assert.ok(postponed, "the section was postponed")
    assert.ok(shell.includes("Header") && shell.includes("loading") && !shell.includes("orders:"))

    const registry = createDeferredRegistry({ store, logger: silent })
    let finish
    registry.defer("orders", new Promise((resolve) => (finish = resolve)), { stateKeys: ["orders"] })
    const html = await new Promise((resolve, reject) => {
        const chunks = []
        const sink = sinkInto(chunks, () => resolve(chunks.join("")))
        const { pipe } = resumeToPipeableStream(
            tree("resume", { deferred: registry, nonce: "N0NCE" }),
            JSON.parse(JSON.stringify(postponed)),
            {
                nonce: "N0NCE",
                onShellReady() {
                    pipe(sink)
                    setImmediate(() => {
                        state.orders = { list: [7] }
                        finish()
                    })
                },
                onShellError: reject,
            }
        )
    })
    assert.ok(html.includes('{\\"list\\":[7]}'), "the resumed section carries its state slice")
    assert.ok(html.includes("orders:1"), "the resumed section has its content")
})
