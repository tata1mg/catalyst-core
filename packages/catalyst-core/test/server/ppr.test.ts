// Unit tests for the PPR helpers in src/server/renderer/ppr.ts.
import { test } from "vitest"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import {
    ShellCache,
    applyNonce,
    createNoncePlaceholder,
    cssSignature,
    guardLateResponseCalls,
    prepareReactScripts,
    serializeForScript,
} from "../../src/server/renderer/ppr.js"

test("serializeForScript cannot break out of a <script>", () => {
    const s = serializeForScript({ a: "</script><script>alert(1)</script>", b: "  " })
    assert.ok(!s.includes("</script>"))
    assert.ok(!s.includes(" ") && !s.includes(" "))
    assert.deepEqual(JSON.parse(s), { a: "</script><script>alert(1)</script>", b: "  " })
    assert.equal(serializeForScript(undefined), "null")
})

test("nonce placeholder is unique and fully replaced", () => {
    const p = createNoncePlaceholder()
    assert.match(p, /^[0-9a-f]{32}$/)
    assert.notEqual(p, createNoncePlaceholder())
    assert.equal(
        applyNonce(`<script nonce="${p}"></script><x nonce="${p}">`, p, "REAL"),
        '<script nonce="REAL"></script><x nonce="REAL">'
    )
    assert.equal(applyNonce("no placeholder", null, "REAL"), "no placeholder")
})

test("React reveal timer is dropped by default and nonced when kept", () => {
    const html =
        '<p></p><script id="_R_">requestAnimationFrame(function(){$RT=performance.now()});</script></body>'
    delete process.env.PPR_REVEAL_THROTTLE
    assert.ok(!prepareReactScripts(html, "PH").includes("_R_"))
    process.env.PPR_REVEAL_THROTTLE = "true"
    assert.ok(prepareReactScripts(html, "PH").includes('<script id="_R_" nonce="PH">'))
    delete process.env.PPR_REVEAL_THROTTLE
})

test("cssSignature ignores order", () => {
    assert.equal(cssSignature(["b.css", "a.css"]), cssSignature(["a.css", "b.css"]))
    assert.notEqual(cssSignature(["a.css"]), cssSignature(["a.css", "b.css"]))
})

test("ShellCache is bounded LRU and builds each key once", async () => {
    process.env.PPR_SHELL_CACHE_MAX = "2"
    const cache = new ShellCache()
    let builds = 0
    const build = (v) => () => new Promise((r) => setTimeout(() => (builds++, r(v)), 5))
    const [a1, a2] = await Promise.all([cache.build("a", build("A")), cache.build("a", build("A2"))])
    assert.equal(a1, "A")
    assert.equal(a2, "A")
    assert.equal(builds, 1)
    await cache.build("b", build("B"))
    cache.get("a") // a is now most recent
    await cache.build("c", build("C"))
    assert.deepEqual(cache.stats().keys.sort(), ["a", "c"])
    assert.equal(await cache.build("nil", async () => null), null)
    assert.equal(cache.get("nil"), undefined)
    delete process.env.PPR_SHELL_CACHE_MAX
})

const fakeRes = () => {
    const res: any = new EventEmitter()
    res.headersSent = false
    res.calls = []
    res.cookie = function (n, v, o) {
        this.calls.push(["cookie", n, v, o])
        return this
    }
    res.clearCookie = function (n) {
        this.calls.push(["clearCookie", n])
        return this
    }
    res.redirect = function (...a) {
        this.calls.push(["redirect", ...a])
        return this
    }
    res.setHeader = function (n, v) {
        this.calls.push(["setHeader", n, v])
        return this
    }
    return res
}

test("late cookie/redirect/header calls after the shell is sent are replayed, not thrown", () => {
    const res = fakeRes()
    const logs = []
    const guard = guardLateResponseCalls(res, { warn: (m) => logs.push(m) })
    res.cookie("early", "1")
    assert.deepEqual(res.calls[0], ["cookie", "early", "1", {}])
    res.headersSent = true
    res.cookie("promo", "3", { maxAge: 1000, sameSite: "lax", secure: true })
    res.cookie("session", "s", { httpOnly: true })
    res.clearCookie("old")
    res.setHeader("x-late", "1")
    res.redirect(301, "/new-home")
    assert.equal(res.calls.length, 1, "late calls must not reach the real response")
    const js = guard.scripts("N")
    assert.ok(js.startsWith('<script nonce="N">'))
    assert.match(js, /document\.cookie="promo=3; Max-Age=1; Expires=[^"]+; Path=\/; Secure; SameSite=lax"/)
    assert.ok(!js.includes("session="), "httpOnly cookies cannot be set from JS")
    assert.match(js, /document\.cookie="old=; Expires=Thu, 01 Jan 1970/)
    assert.ok(js.includes('window.location.replace("/new-home")'))
    assert.equal(logs.length, 2)
    guard.restore()
    res.headersSent = false
    res.cookie("after", "1")
    assert.deepEqual(res.calls.at(-1), ["cookie", "after", "1", undefined])
})

test("priority image preloads are learned and placed before the first head link", async () => {
    const { extractPriorityImagePreloads, findHeadPreloadOffset, insertAt } =
        await import("../../src/server/renderer/ppr.js")
    const resumed =
        '<div hidden id="S:0"><link rel="preload" as="image" href="https://cdn/a.png" fetchPriority="high"/>' +
        '<link rel="preload" as="image" href="https://cdn/lazy.png"/>' +
        '<link rel="preload" as="image" href="https://cdn/a.png" fetchPriority="high"/>' +
        '<link rel="preload" as="image" href="https://cdn/b.png" fetchPriority="high"/>' +
        '<link rel="preload" as="image" href="https://cdn/c.png" fetchPriority="high"/></div>'
    const seen = extractPriorityImagePreloads(resumed)
    assert.deepEqual(
        seen.map((l) => l.match(/href="([^"]+)"/)[1]),
        ["https://cdn/a.png", "https://cdn/b.png", "https://cdn/c.png"]
    )
    const shell =
        '<!DOCTYPE html><html><head><meta charSet="utf-8"/><link rel="preconnect" href="x"/></head><body></body></html>'
    const at = findHeadPreloadOffset(shell)
    assert.equal(shell.slice(at, at + 5), "<link")
    const out = insertAt(shell, at, seen.join(""))
    assert.ok(out.indexOf("a.png") < out.indexOf("preconnect"))
    assert.equal(insertAt(shell, at, ""), shell)
    assert.equal(findHeadPreloadOffset("<html><head></head></html>"), "<html><head>".length)
})

test("learned preloads are replayed only once two responses for the key agree", async () => {
    const { PreloadLearner } = await import("../../src/server/renderer/ppr.js")
    const l = new PreloadLearner(2)
    assert.deepEqual(l.get("home|dpr3"), [])
    l.record("home|dpr3", ["banner", "strip"])
    assert.deepEqual(l.get("home|dpr3"), [], "one response is not enough")
    l.record("home|dpr3", ["banner", "personal"])
    assert.deepEqual(l.get("home|dpr3"), ["banner"], "only what both responses wrote")
    l.record("home|dpr1", ["banner-dpr1"])
    l.record("home|dpr1", ["banner-dpr1"])
    assert.deepEqual(l.get("home|dpr1"), ["banner-dpr1"])
    assert.deepEqual(l.get("home|dpr3"), ["banner"], "other keys are not affected")
    l.record("home|dpr3", [])
    assert.deepEqual(l.get("home|dpr3"), [], "a response without the image stops the preload")
    l.record("third", ["x"])
    assert.equal(l.entries.size, 1, "bounded: cleared when full")
})

test("ShellCache: a build started before delete/clear does not publish; concurrent builds are capped", async () => {
    let release
    const gate = new Promise((r) => (release = r))
    const cache = new ShellCache()
    const stale = cache.build("/a", () => gate.then(() => ({ v: "old" })))
    cache.delete("/a") // e.g. the route learned new CSS while the old shell was building
    const fresh = await cache.build("/a", async () => ({ v: "new" }))
    release()
    await stale
    assert.deepEqual(cache.get("/a"), fresh, "the stale build must not overwrite the fresh shell")

    let release2
    const gate2 = new Promise((r) => (release2 = r))
    const building = cache.build("/b", () => gate2.then(() => ({ v: "b" })))
    cache.clear()
    release2()
    await building
    assert.equal(cache.get("/b"), undefined, "a build that outlived clear() must not publish")

    const hold = new Promise(() => {})
    cache.build("/c", () => hold)
    cache.build("/d", () => hold)
    assert.equal(cache.isSaturated("/e", 2), true, "a third distinct key is refused at max 2")
    assert.equal(cache.isSaturated("/c", 2), false, "a key already building can still be joined")
})
