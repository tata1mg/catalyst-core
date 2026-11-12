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
    DEFER_CLIENT_GONE,
    RENDER_STOPPED,
    DEFERRED_STATE_MERGE,
    createFlushScheduler,
    insertAfterOpenTag,
} from "../src/server/renderer/deferred.js"

// Runs generated inline scripts against a fake window and returns it.
const runScripts = (scripts, window = {}) => {
    const calls = []
    window.location = {
        replace: (url) => calls.push(["replace", url]),
        assign: (url) => calls.push(["assign", url]),
    }
    const context = vm.createContext({ window })
    for (const js of [].concat(scripts)) vm.runInContext(js, context)
    return { window, calls }
}
// Objects created inside the vm context have that context's prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value))
const silent = { warn() {}, error() {} }
const recorder = () => {
    const warnings = []
    const errors = []
    return { warnings, errors, logger: { warn: (m) => warnings.push(m), error: (m) => errors.push(m) } }
}
const storeWith = (state) => ({ getState: () => state })
const turn = () => new Promise((resolve) => setImmediate(resolve))

test("the script marks the section and patches only the listed slices into __INITIAL_STATE__", () => {
    const js = buildDeferredScript({
        name: "orders",
        stateKeys: ["ordersReducer"],
        state: { ordersReducer: { list: [1, 2] }, shellReducer: { title: "x" } },
    })
    const { window } = runScripts(js, {
        __INITIAL_STATE__: { ordersReducer: { list: [] }, shellReducer: { title: "shell" } },
    })
    assert.equal(window.__CATALYST_DEFERRED__.orders, 1)
    assert.deepEqual(plain(window.__INITIAL_STATE__), {
        ordersReducer: { list: [1, 2] },
        shellReducer: { title: "shell" },
    })
    assert.equal(window.__CATALYST_DEFERRED_STATE__, undefined, "no temporary object once the state exists")
})

test("a section written before the state script is merged by it, and the temporary object is dropped", () => {
    const section = buildDeferredScript({ name: "a", stateKeys: ["k"], state: { k: 7 } })
    const stateScript = "window.__INITIAL_STATE__ = { k: 0, other: 1 }\n" + DEFERRED_STATE_MERGE
    const { window } = runScripts([section, stateScript])
    assert.deepEqual(plain(window.__INITIAL_STATE__), { k: 7, other: 1 })
    assert.equal("__CATALYST_DEFERRED_STATE__" in window, false)
})

test("the merge ignores a DOM element that clobbers the global, and inherited properties", () => {
    const element = Object.create({ href: "https://evil.example" }) // named access on window
    element.id = "__CATALYST_DEFERRED_STATE__"
    const { window } = runScripts("window.__INITIAL_STATE__ = { a: 1 }\n" + DEFERRED_STATE_MERGE, {
        __CATALYST_DEFERRED_STATE__: element,
    })
    assert.deepEqual(plain(window.__INITIAL_STATE__), { a: 1 })
})

test("slice values keep a __proto__ key as a plain property", () => {
    const value = JSON.parse('{"__proto__":{"isAdmin":true},"x":1}')
    const js = buildDeferredScript({ name: "a", stateKeys: ["k"], state: { k: value } })
    const { window } = runScripts(js, { __INITIAL_STATE__: {} })
    const k = window.__INITIAL_STATE__.k
    assert.ok(Object.prototype.hasOwnProperty.call(k, "__proto__"))
    assert.equal(k.isAdmin, undefined)
})

test("the script cannot break out of its script tag and leaks no globals", () => {
    const js = buildDeferredScript({
        name: "</script><script>alert(1)",
        stateKeys: ["k"],
        state: { k: "</script><script>alert(2)</SCRIPT><!-- " },
    })
    assert.ok(!/<\/script/i.test(js) && !js.includes("<!--") && !js.includes(" "))
    const { window } = runScripts(js, { __INITIAL_STATE__: {} })
    assert.equal(window.__INITIAL_STATE__.k, "</script><script>alert(2)</SCRIPT><!-- ")
    assert.deepEqual(Object.keys(window).sort(), ["__CATALYST_DEFERRED__", "__INITIAL_STATE__", "location"])
})

test("a slice that is not in the store is left out of the script", () => {
    const js = buildDeferredScript({ name: "a", stateKeys: ["missing", "k"], state: { k: 1 } })
    const { window } = runScripts(js, { __INITIAL_STATE__: {} })
    assert.deepEqual(plain(window.__INITIAL_STATE__), { k: 1 })
})

test("a redirect navigates with replace by default and assign when asked", () => {
    assert.deepEqual(runScripts(buildDeferredScript({ name: "a", redirect: "/login" })).calls, [
        ["replace", "/login"],
    ])
    assert.deepEqual(
        runScripts(buildDeferredScript({ name: "a", redirect: "app://x", mode: "assign" })).calls,
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

test("defer streams by default; the script is built from the store when the section renders", async () => {
    const state = { ordersReducer: { list: [] } }
    const registry = createDeferredRegistry({ store: storeWith(state), logger: silent })
    let finish
    const work = new Promise((resolve) => (finish = resolve))
    assert.equal(registry.defer("orders", work, { stateKeys: ["ordersReducer"] }), work)
    assert.equal(registry.isStreaming, true)
    assert.deepEqual(registry.pending(), ["orders"])

    const entry = registry.get("orders")
    assert.equal(entry.result.status, "pending")
    state.ordersReducer = { list: [1] }
    finish()
    const [result] = await registry.settleAll()
    assert.equal(entry.result.status, "fulfilled")
    assert.equal(entry.result.value, result)
    assert.equal(result.ok, true)
    assert.deepEqual(registry.pending(), [])

    state.ordersReducer = { list: [1, 2] } // changed after the work settled, before the render
    const { window } = runScripts(registry.scriptFor("orders", result), { __INITIAL_STATE__: {} })
    assert.deepEqual(plain(window.__INITIAL_STATE__.ordersReducer), { list: [1, 2] })
})

test("after seal() a defer() is ignored with a warning, and its failure is not unhandled", async () => {
    const { warnings, logger } = recorder()
    const registry = createDeferredRegistry({ store: storeWith({}), logger })
    registry.seal()
    const late = Promise.reject(new Error("late"))
    assert.equal(registry.defer("late", late, { stateKeys: ["k"] }), late)
    assert.equal(registry.size, 0)
    assert.equal(registry.isStreaming, false)
    assert.ok(warnings.some((w) => w.includes("after rendering started")))
    await turn()
})

test("a blocking registry never streams and leaves reporting to the fetcher-error path", async () => {
    const reported = []
    const registry = createDeferredRegistry({
        store: storeWith({}),
        blocking: true,
        onSettledError: (name) => reported.push(name),
        logger: silent,
    })
    registry.defer("a", Promise.reject(new Error("x")))
    assert.equal(registry.blocking, true)
    assert.equal(registry.isStreaming, false)
    const [result] = await registry.settleAll()
    assert.equal(result.ok, false)
    assert.equal(result.name, "a")
    assert.deepEqual(reported, [])
})

test("a failure is reported and mapped to a redirect; unsafe or throwing mappers are ignored", async () => {
    const reported = []
    const registry = createDeferredRegistry({
        store: storeWith({}),
        onSettledError: (name, error) => reported.push([name, error.message]),
        logger: silent,
    })
    registry.defer("string", Promise.reject(new Error("401")), { onError: () => "/login" })
    registry.defer("object", Promise.reject(new Error("e2")), {
        onError: () => ({ redirect: "app://auth", mode: "assign", status: 301 }),
    })
    registry.defer("badStatus", Promise.reject(new Error("e3")), {
        onError: () => ({ redirect: "/x", status: 200 }),
    })
    registry.defer("unsafe", Promise.reject(new Error("e4")), { onError: () => "javascript:alert(1)" })
    registry.defer("throws", Promise.reject(new Error("e5")), {
        onError: () => {
            throw new Error("mapper bug")
        },
    })
    registry.defer("none", Promise.reject(new Error("e6")))
    const results = await registry.settleAll()
    assert.deepEqual(
        results.map((r) => [r.name, r.ok, r.redirect, r.mode, r.status]),
        [
            ["string", false, "/login", "replace", null],
            ["object", false, "app://auth", "assign", 301],
            ["badStatus", false, "/x", "replace", null],
            ["unsafe", false, null, "replace", null],
            ["throws", false, null, "replace", null],
            ["none", false, null, "replace", null],
        ]
    )
    assert.deepEqual(
        reported.map((r) => r[0]),
        ["string", "object", "badStatus", "unsafe", "throws", "none"]
    )
    assert.ok(!registry.scriptFor("unsafe", results[3]).includes("javascript"))
})

test("names must be valid and unique; invalid or missing stateKeys warn outside production", async () => {
    const { warnings, logger } = recorder()
    const registry = createDeferredRegistry({ store: storeWith({ k: 1 }), logger })
    for (const name of ["", undefined, "__proto__", "constructor"]) {
        assert.throws(() => registry.defer(name, Promise.resolve()), TypeError)
    }
    registry.defer("a", Promise.resolve(), { stateKeys: ["k"] })
    registry.defer("a", Promise.reject(new Error("ignored")))
    assert.equal(registry.size, 1)
    assert.ok(warnings.some((w) => w.includes("deferred twice")))

    registry.defer("noKeys", Promise.resolve())
    registry.defer("badKeys", Promise.resolve(), { stateKeys: ["k", "__proto__", 3] })
    assert.equal(warnings.filter((w) => w.includes("stateKeys is missing")).length, 2)
    assert.deepEqual(registry.get("badKeys").stateKeys, ["k"])
    await registry.settleAll()
    await turn()
})

test("a slice that cannot be serialized does not throw: the script only marks the section", async () => {
    const { errors, logger } = recorder()
    const registry = createDeferredRegistry({ store: storeWith({ k: { n: 10n } }), logger })
    registry.defer("a", Promise.resolve(), { stateKeys: ["k"] })
    const [result] = await registry.settleAll()
    const { window } = runScripts(registry.scriptFor("a", result), { __INITIAL_STATE__: {} })
    assert.equal(window.__CATALYST_DEFERRED__.a, 1)
    assert.deepEqual(plain(window.__INITIAL_STATE__), {})
    assert.equal(errors.length, 1)
})

test("outside production, slices changed after the shell but listed nowhere are warned about", async () => {
    const { warnings, logger } = recorder()
    const state = { orders: { list: [] }, cart: { n: 0 } }
    const registry = createDeferredRegistry({ store: storeWith(state), logger })
    registry.defer("orders", Promise.resolve(), { stateKeys: ["orders"] })
    registry.setSnapshot({ ...state })
    state.orders = { list: [1] }
    state.cart = { n: 5 } // the work also changed this, but no stateKeys lists it
    const [result] = await registry.settleAll()
    registry.scriptFor("orders", result)
    assert.equal(warnings.filter((w) => w.includes("cart")).length, 1)
    assert.ok(!warnings.some((w) => w.includes("orders,")))
})

test("a plain value can be deferred", async () => {
    const registry = createDeferredRegistry({ store: storeWith({}), logger: silent })
    registry.defer("value", 42, { stateKeys: [] })
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
    await turn()
    assert.equal(res.flushes, 1)
    schedule()
    res.writableEnded = true
    await turn()
    assert.equal(res.flushes, 1)
    createFlushScheduler({})() // no flush() (no compression): nothing to do
})

test("DEFER_STREAMING_ENABLE=false is the kill switch; Catalyst's own abort reasons are recognised", () => {
    delete process.env.DEFER_STREAMING_ENABLE
    assert.equal(isDeferredStreamingEnabled(), true)
    process.env.DEFER_STREAMING_ENABLE = "false"
    assert.equal(isDeferredStreamingEnabled(), false)
    delete process.env.DEFER_STREAMING_ENABLE
    for (const reason of [DEFER_TIMED_OUT, DEFER_CLIENT_GONE, RENDER_STOPPED]) {
        assert.equal(isDeferAbort(new Error(reason)), true)
    }
    assert.equal(isDeferAbort(new Error("boom")), false)
})
