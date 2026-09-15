/**
 * Headless end-to-end smoke test for the WebMCP POC.
 *
 * Drives the real compiled client bundle through the full agent story:
 *   hydration → tool discovery → declarative navigation → imperative actions →
 *   route-scoped teardown → framework tools (navigate / get_current_route /
 *   get_page_info).
 *
 * Prerequisites:
 *   1. `npm install --no-save --legacy-peer-deps playwright-core` in this dir
 *      (kept out of package.json — repo-wide npm install is unreliable on the
 *      current machine; see the checkpoint's arborist-edgesOut note).
 *   2. A `chromium_headless_shell-*` build in ~/Library/Caches/ms-playwright
 *      (the full `chromium-*` dirs there are empty stubs).
 *   3. Dev server running:  npm start   (serves http://localhost:3005)
 *
 * Then:  node scripts/e2e-smoke.mjs
 */
import { chromium } from "playwright-core"
import fs from "fs"

const CACHE = `${process.env.HOME}/Library/Caches/ms-playwright`
const dir = fs
    .readdirSync(CACHE)
    .filter((d) => /^chromium_headless_shell-\d+$/.test(d))
    .filter((d) => fs.existsSync(`${CACHE}/${d}/chrome-mac/headless_shell`))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0]
if (!dir) {
    console.error("No chromium_headless_shell build found in", CACHE)
    process.exit(2)
}
const exe = `${CACHE}/${dir}/chrome-mac/headless_shell`
const BASE = process.env.WEBMCP_BASE || "http://localhost:3005"

let failures = 0
const check = (name, cond, extra = "") => {
    console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`)
    if (!cond) failures++
}

const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
const consoleLines = []
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`))

const names = () => page.evaluate(() => window.document.modelContext.getTools().map((t) => t.name).sort())
const call = (name, args = {}) =>
    page.evaluate(
        async ([n, a]) => {
            try {
                return { ok: true, r: await window.document.modelContext.executeTool(n, a) }
            } catch (e) {
                return { ok: false, e: String(e), code: e?.code }
            }
        },
        [name, args]
    )

// ── 1. Boot on Home; app-lifetime tools present, route-scoped ones absent ──────
await page.goto(`${BASE}/`, { waitUntil: "networkidle" })
await page.waitForTimeout(700)

let t = await names()
check("document.modelContext present", Array.isArray(t), JSON.stringify(t))
const impl = await page.evaluate(() => (window.document.modelContext.__isWebMcpShim ? "shim" : "native"))
console.log(`   modelContext impl: ${impl}`)
check("declarative 'products' tool present app-wide", t.includes("products"))
check("declarative 'product' tool present app-wide", t.includes("product"))
check("framework 'navigate' present", t.includes("navigate"))
check("framework 'get_current_route' present", t.includes("get_current_route"))
check("framework 'get_page_info' present", t.includes("get_page_info"))
check("imperative 'add_to_cart' NOT present on / (route-scoped)", !t.includes("add_to_cart"), JSON.stringify(t))

// ── 2. get_page_info reads the page's own setMetaData ─────────────────────────
let r = await call("get_page_info")
check("get_page_info on / returns the page title", r.ok && /WebMCP POC/.test(r.r.title || ""), JSON.stringify(r.r))
check("  → and its description", r.ok && /WebMCP tools/.test(r.r.description || ""))

// ── 3. Declarative navigation with filters, from Home, no page visit needed ───
r = await call("products", { category: "footwear", maxPrice: 3000 })
check("products({footwear, maxPrice:3000}) navigated", r.ok && r.r.navigated, JSON.stringify(r))
check(
    "  → landed on the filtered URL",
    r.ok && /\/products\?/.test(r.r.path) && /category=footwear/.test(r.r.path) && /maxPrice=3000/.test(r.r.path),
    r.ok ? r.r.path : ""
)
await page.waitForTimeout(400)
check("  → browser actually navigated there", (await page.url()).includes("category=footwear"), await page.url())

r = await call("get_current_route")
check("get_current_route reports /products", r.ok && r.r.pathname === "/products", JSON.stringify(r.r))
check("get_page_info now reflects the catalogue page", (await call("get_page_info")).r.title?.includes("all products"))

// ── 4. Open a product; its imperative tool appears ───────────────────────────
r = await call("product", { id: "trail-runner-x" })
check("product({id:'trail-runner-x'}) navigated", r.ok && r.r.navigated, JSON.stringify(r))
await page.waitForTimeout(500)
t = await names()
check("on /product/:id : add_to_cart NOW present", t.includes("add_to_cart"), JSON.stringify(t))

// ── 5. Imperative action + typed errors ─────────────────────────────────────
r = await call("add_to_cart", { quantity: 2 })
check("add_to_cart({quantity:2}) ran + returned a human string", r.ok && /Trail Runner X/.test(r.r), JSON.stringify(r))
r = await call("add_to_cart", { quantity: "lots" })
check("add_to_cart bad args → typed error", !r.ok && r.code === "WEBMCP_INVALID_ARGS", JSON.stringify(r))

// ── 6. navigate() to cart; route-scoped tool swaps ─────────────────────────
r = await call("navigate", { path: "/cart" })
check("navigate({path:'/cart'}) ok", r.ok && r.r.navigated, JSON.stringify(r))
await page.waitForTimeout(500)
t = await names()
check("on /cart : checkout present, add_to_cart gone", t.includes("checkout") && !t.includes("add_to_cart"), JSON.stringify(t))
r = await call("add_to_cart", { quantity: 1 })
check("stale add_to_cart call on /cart rejected", !r.ok, JSON.stringify(r))
r = await call("checkout")
check("checkout ran", r.ok && /placed/i.test(r.r), JSON.stringify(r))

// ── 7. navigate() rejects an unknown destination ──────────────────────────
r = await call("navigate", { path: "/nope" })
check("navigate rejects an unknown path", !r.ok, JSON.stringify(r))

// ── 8. Re-navigation re-registers cleanly (no leaked names) ───────────────
await page.click('a[href="/products"]')
await page.waitForTimeout(300)
await page.click('a[href^="/product/"]')
await page.waitForTimeout(500)
t = await names()
check("re-nav to a product: add_to_cart back, checkout gone", t.includes("add_to_cart") && !t.includes("checkout"), JSON.stringify(t))

console.log("\n--- webmcp console output ---")
consoleLines.filter((l) => /webmcp/i.test(l)).forEach((l) => console.log("  " + l))

await browser.close()
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`)
process.exit(failures === 0 ? 0 : 1)
