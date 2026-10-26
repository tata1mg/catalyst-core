/**
 * Headless end-to-end smoke test for WebMCP in the docs app — the same
 * pattern as examples/webmcp-poc/scripts/e2e-smoke.mjs, but exercising the
 * PACKAGED catalyst-core/webmcp subpath against a real docs page (search
 * over the build-time manifest, not a POC's toy product catalogue).
 *
 * Drives the agreed test flow: search_docs("ssr data fetching") ->
 * get_doc_content(result) -> confirm the browser actually navigated, real
 * page content came back in the same call, AND the page auto-scrolled +
 * highlighted without any further tool call (get_doc_content/open_doc both
 * navigate AND auto-highlight now — see DocsLayout.js's comments on why:
 * first a pure-read get_doc_content never navigated because an agent with
 * content already in hand had no reason to also call open_doc, then even
 * once navigation was automatic, a "call highlight_content yourself" hint
 * in the result was reliably ignored across multiple live sessions, so
 * both navigating tools now highlight unconditionally). highlight_content
 * remains a standalone tool for RE-highlighting without a fresh navigation.
 *
 * Prerequisites:
 *   1. `npm install --no-save --legacy-peer-deps playwright-core` in this dir
 *   2. A `chromium_headless_shell-*` build in ~/Library/Caches/ms-playwright
 *   3. `npm run sync-core` to pull the local catalyst-core build in, then
 *      `npm start` (serves http://localhost:3005)
 *
 * Then:  node scripts/webmcp-e2e-smoke.mjs
 */
import { chromium } from "playwright-core"
import fs from "fs"
const CACHE = `${process.env.HOME}/Library/Caches/ms-playwright`
const dir = fs.readdirSync(CACHE).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).filter((d) => fs.existsSync(`${CACHE}/${d}/chrome-mac/headless_shell`)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0]
const exe = `${CACHE}/${dir}/chrome-mac/headless_shell`
const BASE = "http://localhost:3005"
let failures = 0
const check = (name, cond, extra = "") => {
    console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`)
    if (!cond) failures++
}
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
const call = (name, args = {}) =>
    page.evaluate(async ([n, a]) => {
        try { return { ok: true, r: await window.document.modelContext.executeTool(n, a) } }
        catch (e) { return { ok: false, e: String(e), code: e?.code } }
    }, [name, args])

await page.goto(`${BASE}/`, { waitUntil: "networkidle" })
await page.waitForTimeout(700)

let t = await page.evaluate(() => window.document.modelContext.getTools().map(t=>t.name).sort())
check("all 7 tools present on home page", ["get_current_route","get_doc_content","get_page_info","highlight_content","navigate","open_doc","search_docs"].every(n => t.includes(n)), JSON.stringify(t))

// highlight_content on the home page (no .doc-article) reports false, not an error.
let r0 = await call("highlight_content")
check("highlight_content on a non-article page reports highlighted:false", r0.ok && r0.r.highlighted === false, JSON.stringify(r0))

// --- Primary flow: search_docs -> get_doc_content (reads AND navigates) ---
let r = await call("search_docs", { query: "ssr data fetching" })
check("search_docs found results", r.ok && r.r.count > 0, JSON.stringify(r.r?.results?.map(x=>x.title)))

const target = r.ok && r.r.results.find(x => /ssr|fetch/i.test(x.title))
check("a relevant result exists in the top results", !!target, target?.title)

r = await call("get_doc_content", { url: target.url })
check("get_doc_content returns real page content", r.ok && typeof r.r.content === "string" && r.r.content.length > 100, r.ok ? `${r.r.content.length} chars` : JSON.stringify(r))
check("get_doc_content reports it auto-highlighted", r.ok && r.r.highlighted === true, JSON.stringify(r))

let browserUrl = await page.url()
check("get_doc_content ALSO navigated the browser there", decodeURIComponent(browserUrl).endsWith(target.url), browserUrl)

// get_doc_content now auto-highlights (awaits the post-navigation poll
// itself before returning) — no separate highlight_content call needed.
let hasHighlight = await page.evaluate(() => !!document.querySelector(".webmcp-doc-highlight"))
check("get_doc_content's auto-highlight actually applied the class", hasHighlight === true, String(hasHighlight))

r = await call("get_page_info")
check("get_page_info reflects the new page", r.ok && r.r.title, r.r?.title)

// --- highlight_content: standalone RE-highlight, no navigation involved ---
await page.waitForTimeout(1700) // let the first highlight's animation fully clear
r = await call("highlight_content")
check("highlight_content on the current doc page reports highlighted:true", r.ok && r.r.highlighted === true, JSON.stringify(r))
hasHighlight = await page.evaluate(() => !!document.querySelector(".webmcp-doc-highlight"))
check("highlight_content actually (re)applies the highlight class", hasHighlight === true, String(hasHighlight))

// --- open_doc: the narrower "navigate without reading" tool — also auto-highlights ---
r = await call("navigate", { path: "/" })
check("reset to home via navigate", r.ok, JSON.stringify(r))
await page.waitForTimeout(300)

r = await call("open_doc", { url: target.url })
check("open_doc navigates and reports it auto-highlighted", r.ok && r.r.navigated && r.r.highlighted === true, JSON.stringify(r))
browserUrl = await page.url()
check("open_doc alone actually moved the browser", decodeURIComponent(browserUrl).endsWith(target.url), browserUrl)

r = await call("open_doc", { url: "/content/not-a-real-page" })
check("open_doc rejects an unknown url with a typed error", !r.ok && r.code === "WEBMCP_INVALID_ARGS", JSON.stringify(r))

r = await call("get_doc_content", { url: "/content/not-a-real-page" })
check("get_doc_content rejects an unknown url with a typed error", !r.ok && r.code === "WEBMCP_INVALID_ARGS", JSON.stringify(r))

r = await call("navigate", { path: "/content/some-doc" })
check("navigate rejects a /content/ path (excluded from its enum)", !r.ok, JSON.stringify(r))

await browser.close()
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`)
process.exit(failures === 0 ? 0 : 1)
