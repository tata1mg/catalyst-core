// Unit tests for deferred route data (no React): node --test test/deferred.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import {
    buildDeferredScript,
    createDeferredRegistry,
    isSafeRedirect,
    isDeferredStreamingEnabled,
    isDeferAbort,
    DEFER_TIMED_OUT,
    createFlushScheduler,
    insertAfterOpenTag,
} from "../src/server/renderer/deferred.js"

// Runs a generated inline script against a fake window and returns it.
const runScript = (js, initialState) => {
    const calls = []
    const window = {
        location: {
            replace: (url) => calls.push(["replace", url]),
            assign: (url) => calls.push(["assign", url]),
        },
    }
    if (initialState) window.__INITIAL_STATE__ = initialState
    vm.runInNewContext(js, { window })
    return { window, calls }
}

// Objects created inside the vm context have that context's prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value))
const silentLogger = { warn() {}, error() {} }
const storeWith = (state) => ({ getState: () => state })

test("the script marks the section and patches only the listed state keys", () => {
    const js = buildDeferredScript({
        name: "orders",
        stateKeys: ["ordersReducer"],
        state: { ordersReducer: { list: [1, 2] }, shellReducer: { title: "x" } },
    })
    const { window } = runScript(js, { ordersReducer: { list: [] }, shellReducer: { title: "shell" } })
    assert.equal(window.__CATALYST_DEFERRED__.orders, 1)
    assert.deepEqual(plain(window.__INITIAL_STATE__.ordersReducer), { list: [1, 2] })
    assert.deepEqual(plain(window.__INITIAL_STATE__.shellReducer), { title: "shell" })
    assert.deepEqual(plain(window.__CATALYST_DEFERRED_STATE__.ordersReducer), { list: [1, 2] })
})

test("a section written before the state script leaves its state for the document to merge", () => {
    const js = buildDeferredScript({ name: "a", stateKeys: ["k"], state: { k: 7 } })
    const { window } = runScript(js)
    assert.equal(window.__INITIAL_STATE__, undefined)
    assert.deepEqual(plain(window.__CATALYST_DEFERRED_STATE__), { k: 7 })
    // What Body.jsx runs right after it assigns window.__INITIAL_STATE__.
    window.__INITIAL_STATE__ = { k: 0, other: 1 }
    vm.runInNewContext(
        ";(function(d,s){if(d&&s)for(var k in d)s[k]=d[k]})(window.__CATALYST_DEFERRED_STATE__,window.__INITIAL_STATE__)",
        { window }
    )
    assert.deepEqual(plain(window.__INITIAL_STATE__), { k: 7, other: 1 })
})

test("the script cannot break out of its script tag and leaks no globals", () => {
    const js = buildDeferredScript({
        name: "</script><script>alert(1)",
        stateKeys: ["k"],
        state: { k: "</script><script>alert(2)</script> " },
    })
    assert.ok(!js.includes("</script"))
    assert.ok(!js.includes(" "))
    const { window } = runScript(js, {})
    assert.equal(window.__INITIAL_STATE__.k, "</script><script>alert(2)</script> ")
    assert.deepEqual(Object.keys(window).sort(), [
        "__CATALYST_DEFERRED_STATE__",
        "__CATALYST_DEFERRED__",
        "__INITIAL_STATE__",
        "location",
    ])
})

test("a redirect navigates with replace by default and assign when asked", () => {
    assert.deepEqual(runScript(buildDeferredScript({ name: "a", redirect: "/login" })).calls, [
        ["replace", "/login"],
    ])
    assert.deepEqual(
        runScript(buildDeferredScript({ name: "a", redirect: "app://x", mode: "assign" })).calls,
        [["assign", "app://x"]]
    )
})

test("unsafe redirect schemes are refused", () => {
    for (const url of [
        "javascript:alert(1)",
        " JavaScript:x",
        "java\tscript:x",
        "data:text/html,x",
        "vbscript:x",
        "",
    ]) {
        assert.equal(isSafeRedirect(url), false, url)
    }
    for (const url of ["/login?next=/a", "https://example.com/x", "onemg://www.1mg.com/home", "login"]) {
        assert.equal(isSafeRedirect(url), true, url)
    }
})

test("defer streams by default and the result is readable synchronously once settled", async () => {
    const state = { ordersReducer: { list: [] } }
    const registry = createDeferredRegistry({ store: storeWith(state), logger: silentLogger })
    let finish
    const work = new Promise((resolve) => (finish = resolve))
    assert.equal(registry.defer("orders", work, { stateKeys: ["ordersReducer"] }), work)
    assert.equal(registry.isStreaming, true)
    assert.equal(registry.size, 1)

    const entry = registry.get("orders")
    assert.equal(entry.result.status, "pending")
    state.ordersReducer = { list: [1] } // the work updates the store before it settles
    finish()
    const [result] = await registry.settleAll()
    assert.equal(entry.result.status, "fulfilled")
    assert.equal(entry.result.value, result)
    assert.equal(result.ok, true)
    assert.equal(result.redirect, null)
    const { window } = runScript(result.html, {})
    assert.deepEqual(plain(window.__INITIAL_STATE__.ordersReducer), { list: [1] })
})

test("a blocking registry never streams", () => {
    const registry = createDeferredRegistry({ store: storeWith({}), blocking: true, logger: silentLogger })
    registry.defer("a", Promise.resolve())
    assert.equal(registry.blocking, true)
    assert.equal(registry.isStreaming, false)
})

test("a failure is reported and mapped to a redirect; unsafe or throwing mappers are ignored", async () => {
    const reported = []
    const registry = createDeferredRegistry({
        store: storeWith({}),
        onSettledError: (name, error) => reported.push([name, error.message]),
        logger: silentLogger,
    })
    registry.defer("string", Promise.reject(new Error("401")), { onError: () => "/login" })
    registry.defer("object", Promise.reject(new Error("e2")), {
        onError: () => ({ redirect: "app://auth", mode: "assign" }),
    })
    registry.defer("unsafe", Promise.reject(new Error("e3")), { onError: () => "javascript:alert(1)" })
    registry.defer("throws", Promise.reject(new Error("e4")), {
        onError: () => {
            throw new Error("mapper bug")
        },
    })
    registry.defer("none", Promise.reject(new Error("e5")))
    const results = await registry.settleAll()
    assert.deepEqual(
        results.map((r) => [r.ok, r.redirect, r.mode]),
        [
            [false, "/login", "replace"],
            [false, "app://auth", "assign"],
            [false, null, "replace"],
            [false, null, "replace"],
            [false, null, "replace"],
        ]
    )
    assert.deepEqual(
        reported.map((r) => r[0]),
        ["string", "object", "unsafe", "throws", "none"]
    )
    assert.ok(!results[2].html.includes("javascript"))
})

test("names must be non-empty strings and a duplicate name is ignored", async () => {
    const warnings = []
    const registry = createDeferredRegistry({
        store: storeWith({ k: 1 }),
        logger: { warn: (m) => warnings.push(m), error() {} },
    })
    assert.throws(() => registry.defer("", Promise.resolve()), TypeError)
    assert.throws(() => registry.defer(undefined, Promise.resolve()), TypeError)
    registry.defer("a", Promise.resolve(), { stateKeys: ["k"] })
    registry.defer("a", Promise.reject(new Error("ignored")))
    assert.equal(registry.size, 1)
    assert.equal(warnings.length, 1)
    const [result] = await registry.settleAll()
    assert.equal(result.ok, true)
})

test("a plain value can be deferred", async () => {
    const registry = createDeferredRegistry({ store: storeWith({}), logger: silentLogger })
    registry.defer("value", 42)
    const [result] = await registry.settleAll()
    assert.equal(result.ok, true)
})

test("the reveal script goes right after the opening head tag, not into a header", () => {
    const S = "<script>X</script>"
    const at = (html) => insertAfterOpenTag(Buffer.from(html), S)?.toString()
    assert.equal(at("<!DOCTYPE html><html><head><meta/>"), `<!DOCTYPE html><html><head>${S}<meta/>`)
    assert.equal(at('<html><head lang="en"><title>'), `<html><head lang="en">${S}<title>`)
    assert.equal(at("<html><header>x</header><head>y"), `<html><header>x</header><head>${S}y`)
    assert.equal(at('<html><body class="a">z'), `<html><body class="a">${S}z`)
    assert.equal(at("<div>no document tags</div>"), undefined)
})

test("inserting the reveal script leaves a multi-byte character split across chunks intact", () => {
    const first = Buffer.from("<html><head><title>नमस्ते")
    const cut = first.subarray(0, first.length - 1) // ends inside the last character
    const script = "<s>"
    const out = insertAfterOpenTag(cut, script)
    assert.deepEqual(out.subarray(out.length - 8), cut.subarray(cut.length - 8))
    assert.equal(out.length, cut.length + Buffer.byteLength(script))
})

test("the response is flushed once per event-loop turn, and not after it ended", async () => {
    const res = {
        flushes: 0,
        writableEnded: false,
        flush() {
            this.flushes++
        },
    }
    const schedule = createFlushScheduler(res)
    schedule()
    schedule()
    schedule()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(res.flushes, 1)
    schedule()
    res.writableEnded = true
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(res.flushes, 1)
    createFlushScheduler({})() // no flush() (no compression): nothing to do
})

test("DEFER_STREAMING_ENABLE=false is the kill switch; abort reasons are recognised", () => {
    delete process.env.DEFER_STREAMING_ENABLE
    assert.equal(isDeferredStreamingEnabled(), true)
    process.env.DEFER_STREAMING_ENABLE = "false"
    assert.equal(isDeferredStreamingEnabled(), false)
    delete process.env.DEFER_STREAMING_ENABLE
    assert.equal(isDeferAbort(new Error(DEFER_TIMED_OUT)), true)
    assert.equal(isDeferAbort(new Error("boom")), false)
})
