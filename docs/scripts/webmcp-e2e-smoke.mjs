/**
 * Headless end-to-end smoke test for WebMCP in the docs app — the same
 * pattern as examples/webmcp-poc/scripts/e2e-smoke.mjs, but exercising the
 * PACKAGED catalyst-core/webmcp subpath against a real docs page (search
 * over the build-time manifest, not a POC's toy product catalogue).
 *
 * Drives the agreed test flow: search_docs("ssr data fetching") ->
 * open_doc(result) -> confirm the browser actually navigated + get_page_info
 * reflects the new page. Also checks the empty-tool-list-on-content-pages
 * boundary (open_doc rejects an unknown url; navigate's enum excludes the
 * generated /content/ routes per routes/utils.js's isNavigableForAgents).
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
check("all 5 tools present on home page", ["get_current_route","get_page_info","navigate","open_doc","search_docs"].every(n => t.includes(n)), JSON.stringify(t))

// Simulated agent flow for "Find the page that explains SSR data fetching and open it."
let r = await call("search_docs", { query: "ssr data fetching" })
check("search_docs found results", r.ok && r.r.count > 0, JSON.stringify(r.r?.results?.map(x=>x.title)))

const target = r.ok && r.r.results.find(x => /ssr|fetch/i.test(x.title))
check("a relevant result exists in the top results", !!target, target?.title)

r = await call("open_doc", { url: target.url })
check("open_doc navigated", r.ok && r.r.navigated, JSON.stringify(r))
await page.waitForTimeout(500)

const browserUrl = await page.url()
check("browser actually navigated to the target page", decodeURIComponent(browserUrl).endsWith(target.url), browserUrl)

r = await call("get_page_info")
check("get_page_info reflects the new page", r.ok && r.r.title, r.r?.title)

r = await call("open_doc", { url: "/content/not-a-real-page" })
check("open_doc rejects an unknown url with a typed error", !r.ok && r.code === "WEBMCP_INVALID_ARGS", JSON.stringify(r))

r = await call("navigate", { path: "/content/some-doc" })
check("navigate rejects a /content/ path (excluded from its enum)", !r.ok, JSON.stringify(r))

await browser.close()
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`)
process.exit(failures === 0 ? 0 : 1)
