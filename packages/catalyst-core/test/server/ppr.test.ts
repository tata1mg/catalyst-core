// Unit tests for the PPR helpers in src/server/renderer/ppr.ts.
import { test, vi } from "vitest"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import {
    ShellCache,
    applyNonce,
    createNoncePlaceholder,
    cssSignature,
    guardLateResponseCalls,
    isReplayableRedirect,
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

test("ShellCache with a byte budget evicts least recently used entries and skips oversized ones", () => {
    let maxBytes = 10
    const cache = new ShellCache({ maxEntries: () => 10, maxBytes: () => maxBytes, sizeOf: (v) => v.length })
    cache.set("a", "aaaa")
    cache.set("b", "bbbb")
    cache.get("a") // b is now least recent
    cache.set("c", "cccc") // 12 bytes: b goes
    assert.deepEqual(cache.stats().keys.sort(), ["a", "c"])
    assert.equal(cache.stats().bytes, 8)
    cache.set("a", "aa") // replacing an entry swaps its size
    assert.equal(cache.stats().bytes, 6)
    cache.set("big", "x".repeat(11)) // larger than the whole budget: not cached, nothing evicted
    assert.equal(cache.get("big"), undefined)
    assert.deepEqual(cache.stats().keys.sort(), ["a", "c"])
    cache.delete("c")
    assert.equal(cache.stats().bytes, 2)
    maxBytes = -1 // negative: no byte budget
    cache.set("big", "x".repeat(100))
    assert.equal(cache.get("big"), "x".repeat(100))
    cache.clear()
    assert.deepEqual(cache.stats(), { size: 0, bytes: 0, keys: [], building: 0 })
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

test("a late redirect is replayed only for relative and http(s) URLs", () => {
    for (const url of [
        "/login",
        "login?next=/a",
        "//cdn.example.com/x",
        "https://example.com/",
        "http://a.b",
    ]) {
        assert.ok(isReplayableRedirect(url), url)
    }
    for (const url of [
        "javascript:alert(1)",
        " JavaScript:alert(1)",
        "java\tscript:alert(1)",
        "\u0001javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:x",
        "",
        undefined,
    ]) {
        assert.ok(!isReplayableRedirect(url), String(url))
    }

    const res = fakeRes()
    const logs = []
    const guard = guardLateResponseCalls(res, { warn: (m) => logs.push(m) })
    res.headersSent = true
    res.redirect(302, "javascript:alert(document.cookie)")
    assert.equal(guard.redirectTo, null)
    assert.equal(guard.scripts(), "")
    assert.match(logs[0], /non-http\(s\) URL was dropped/)
})

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

test("ShellCache with maxAgeMs drops an entry once it is older than the limit", () => {
    vi.useFakeTimers()
    try {
        const cache = new ShellCache({ maxBytes: () => 100, sizeOf: (v: string) => v.length, maxAgeMs: () => 1000 })
        cache.set("a", "page")
        vi.advanceTimersByTime(999)
        assert.equal(cache.get("a"), "page")
        vi.advanceTimersByTime(1)
        assert.equal(cache.get("a"), undefined)
        assert.equal(cache.stats().size, 0)
        assert.equal(cache.bytes, 0)
        // Storing it again restarts its age; without a limit entries never expire.
        cache.set("a", "page")
        vi.advanceTimersByTime(500)
        assert.equal(cache.get("a"), "page")
        const forever = new ShellCache()
        forever.set("b", "page")
        vi.advanceTimersByTime(10 ** 9)
        assert.equal(forever.get("b"), "page")
    } finally {
        vi.useRealTimers()
    }
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

test("guarded calls pass through before the shell is sent; restore() puts the originals back", () => {
    const res = fakeRes()
    const own = { cookie: res.cookie, clearCookie: res.clearCookie, redirect: res.redirect }
    const guard = guardLateResponseCalls(res, { warn() {} })
    res.clearCookie("early")
    res.redirect(302, "/login")
    assert.deepEqual(res.calls, [
        ["clearCookie", "early"],
        ["redirect", 302, "/login"],
    ])
    res.headersSent = true
    res.cookie("pref", { theme: "dark" }, { domain: "example.com", expires: new Date(0) })
    res.redirect("/elsewhere")
    const js = guard.scripts()
    assert.match(
        js,
        /document\.cookie="pref=j%3A%7B%22theme%22%3A%22dark%22%7D; Expires=Thu, 01 Jan 1970[^"]*; Domain=example\.com; Path=\/"/
    )
    assert.equal(guard.redirectTo, "/elsewhere")
    guard.restore()
    assert.equal(res.cookie, own.cookie)
    assert.equal(res.clearCookie, own.clearCookie)
    assert.equal(res.redirect, own.redirect)

    // Methods that came from the prototype (not own properties) are removed again, not copied on.
    class Proto extends EventEmitter {
        cookie() {
            return this
        }
    }
    const inherited: any = new Proto()
    const g2 = guardLateResponseCalls(inherited)
    assert.ok(Object.prototype.hasOwnProperty.call(inherited, "cookie"))
    g2.restore()
    assert.ok(!Object.prototype.hasOwnProperty.call(inherited, "cookie"))
    assert.equal(g2.scripts("n"), "")
})

test("priority preload extraction stops at MAX_LEARNED_PRELOADS; no <head> means no offset", async () => {
    const { extractPriorityImagePreloads, findHeadPreloadOffset, MAX_LEARNED_PRELOADS } =
        await import("../../src/server/renderer/ppr.js")
    const html = Array.from(
        { length: MAX_LEARNED_PRELOADS + 2 },
        (_, i) => `<link rel="preload" as="image" href="https://cdn/${i}.png" fetchPriority="high"/>`
    ).join("")
    assert.equal(extractPriorityImagePreloads(html).length, MAX_LEARNED_PRELOADS)
    assert.equal(findHeadPreloadOffset("<div>no head</div>"), -1)
})

test("ShellCache starts a new epoch once 10000 keys have been deleted", async () => {
    const cache = new ShellCache()
    for (let i = 0; i <= 10000; i++) cache.delete(`/k${i}`)
    assert.equal(cache.epoch, 1)
    assert.equal(cache.versions.size, 0)
})

test("the PPR shell cache helpers clear and report the shared cache", async () => {
    const { clearPPRShellCache, getPPRShellCacheStats, shellCache } =
        await import("../../src/server/renderer/ppr.js")
    shellCache.set("/x|", { prelude: "x" })
    assert.deepEqual(getPPRShellCacheStats().keys, ["/x|"])
    clearPPRShellCache()
    assert.equal(getPPRShellCacheStats().size, 0)
})
