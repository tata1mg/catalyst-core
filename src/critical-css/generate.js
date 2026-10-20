/**
 * Build-time critical CSS generation.
 *
 * Loads each configured route from a running production server in a headless browser, at several
 * viewports, with JavaScript off (what first paint shows) and on (what hydration shows), and keeps the
 * rules that style anything above the fold. Output goes to <build>/critical-css/ with a manifest that
 * the SSR handler reads; a route without an entry keeps today's behaviour (all route CSS inlined).
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { parseCss, collectQueries, matchInPage, pruneRoot } from "./core.js"

export const MANIFEST_FILE = "manifest.json"
export const DEFAULT_VIEWPORTS = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 430, height: 932 },
]
export const DEFAULT_MAX_BYTES = 40 * 1024
export const DEFAULT_USER_AGENT =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex")

// Runs in the page: the full route CSS that catalyst emitted, in cascade order (never the critical subset).
function listRouteCss() {
    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll("style[data-catalyst-css], link[data-catalyst-css]")) {
        if (el.getAttribute("data-catalyst-css") === "critical") continue
        if (el.tagName === "STYLE") out.push({ kind: "inline", text: el.textContent })
        else if (!seen.has(el.href)) {
            seen.add(el.href)
            out.push({ kind: "link", href: el.href })
        }
    }
    return out
}

/**
 * @param {object} opts
 * @param {object} opts.chromium - playwright(-core) chromium BrowserType
 * @param {string} opts.baseUrl - running production server, e.g. http://localhost:3005
 * @param {{route: string, urls: string[]}[]} opts.routes - route pattern (as in the router) + sample URLs
 * @param {string} opts.outDir - <build>/critical-css
 */
export async function generateCriticalCss({
    chromium,
    baseUrl,
    routes,
    outDir,
    viewports = DEFAULT_VIEWPORTS,
    userAgent = DEFAULT_USER_AGENT,
    maxBytes = DEFAULT_MAX_BYTES,
    settleMs = 2500,
    launchOptions = {},
    log = console.log,
}) {
    fs.mkdirSync(outDir, { recursive: true })
    const browser = await chromium.launch(launchOptions)
    const manifest = { version: 1, generatedAt: new Date().toISOString(), viewports, maxBytes, routes: {} }
    const textCache = new Map()
    const fetchText = async (href) => {
        if (!textCache.has(href)) {
            const r = await fetch(href, { headers: { "user-agent": userAgent } })
            if (!r.ok) throw new Error(`critical-css: ${href} → ${r.status}`)
            textCache.set(href, await r.text())
        }
        return textCache.get(href)
    }

    try {
        for (const { route, urls } of routes) {
            const sources = new Map() // content hash → { root, text, href }
            const results = []
            for (const url of urls) {
                for (const viewport of viewports) {
                    for (const javaScriptEnabled of [false, true]) {
                        const ctx = await browser.newContext({
                            viewport,
                            deviceScaleFactor: 2,
                            isMobile: true,
                            hasTouch: true,
                            userAgent,
                            javaScriptEnabled,
                            serviceWorkers: "block",
                        })
                        try {
                            const page = await ctx.newPage()
                            const res = await page.goto(baseUrl + url, { waitUntil: "load", timeout: 90000 })
                            if (!res || res.status() >= 400) throw new Error(`critical-css: ${url} → ${res?.status()}`)
                            if (javaScriptEnabled) {
                                await page.waitForTimeout(settleMs)
                                await page.evaluate(() => window.scrollTo(0, 0))
                            }
                            const listed = await page.evaluate(listRouteCss)
                            if (!listed.length) throw new Error(`critical-css: no data-catalyst-css styles on ${url}`)
                            const roots = []
                            for (const s of listed) {
                                const text = s.kind === "inline" ? s.text : await fetchText(s.href)
                                const key = sha(text)
                                if (!sources.has(key)) sources.set(key, { text, href: s.href, root: parseCss(text, s.href || "inline") })
                                roots.push(sources.get(key).root)
                            }
                            const q = collectQueries(roots)
                            results.push(await page.evaluate(matchInPage, { ...q, foldHeight: viewport.height }))
                        } finally {
                            await ctx.close()
                        }
                    }
                }
            }

            let css = ""
            let keptRules = 0
            let totalRules = 0
            let sourceBytes = 0
            for (const s of sources.values()) {
                const pruned = pruneRoot(s.root, results, "above")
                css += pruned.css
                keptRules += pruned.keptRules
                totalRules += pruned.totalRules
                sourceBytes += Buffer.byteLength(s.text)
            }
            const bytes = Buffer.byteLength(css)
            const slug = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root"
            const file = `${slug}.${sha(css).slice(0, 10)}.css`
            fs.writeFileSync(path.join(outDir, file), css)
            manifest.routes[route] = {
                file,
                bytes,
                sourceBytes,
                keptRules,
                totalRules,
                urls,
                overBudget: bytes > maxBytes,
            }
            log(
                `critical-css: ${route} → ${file} ${(bytes / 1024).toFixed(1)} KB of ${(sourceBytes / 1024).toFixed(1)} KB` +
                    ` (${keptRules}/${totalRules} rules)${bytes > maxBytes ? ` — over the ${maxBytes} byte budget, route will keep full inline CSS` : ""}`
            )
        }
    } finally {
        await browser.close()
    }
    fs.writeFileSync(path.join(outDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2))
    return manifest
}
