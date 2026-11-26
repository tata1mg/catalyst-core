// Cold page loads measured in the browser itself, under each throttling profile, a fresh Chrome per run.
// Per run: TTFB, FCP, LCP, DOMContentLoaded, load, hydration, bytes and requests, long tasks.
// Writes every run plus median / p75 / p95 to results/data/navigation.json.
//
// usage: node navigation.mjs [runs=10]
import puppeteer from "puppeteer-core"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { CHROME, HEADER_LINK, PAGES, PROFILES, RESULTS_DIR, VIEWPORT, ensureDir, environment, runCount, stats, watchHydration } from "./lib.mjs"

const RUNS = runCount(10)

// LCP and long tasks; hydration (of the header link, on both pages) comes from watchHydration in lib.mjs.
function installObservers() {
    window.__bench = Object.assign(window.__bench || {}, { lcp: null, longTasks: [] })
    new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1)
        window.__bench.lcp = { time: last.startTime, element: last.element ? last.element.tagName : null }
    }).observe({ type: "largest-contentful-paint", buffered: true })
    new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__bench.longTasks.push(e.duration)
    }).observe({ type: "longtask", buffered: true })
}

async function measure(browser, url, profile) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    try {
        await page.setViewport(VIEWPORT)
        const cdp = await page.createCDPSession()
        await cdp.send("Network.enable")
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate })
        if (profile.network) await cdp.send("Network.emulateNetworkConditions", profile.network)

        const types = new Map()
        const bytes = { js: 0, css: 0, html: 0, image: 0, other: 0 }
        let requests = 0
        cdp.on("Network.requestWillBeSent", (e) => types.set(e.requestId, e.type))
        cdp.on("Network.loadingFinished", (e) => {
            requests++
            const kind = { Script: "js", Stylesheet: "css", Document: "html", Image: "image" }[types.get(e.requestId)] || "other"
            bytes[kind] += e.encodedDataLength
        })

        await page.evaluateOnNewDocument(installObservers)
        await page.evaluateOnNewDocument(watchHydration, HEADER_LINK)
        await page.goto(url, { waitUntil: "load", timeout: 120000 })
        await page.waitForFunction(() => window.__bench.hydrated !== null, { timeout: 30000, polling: 50 })
        await new Promise((resolve) => setTimeout(resolve, 1000)) // let late LCP candidates and long tasks land

        const timing = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0]
            const fcp = performance.getEntriesByName("first-contentful-paint")[0]
            const { lcp, longTasks, hydrated } = window.__bench
            return {
                ttfb: nav.responseStart,
                fcp: fcp ? fcp.startTime : null,
                lcp: lcp ? lcp.time : null,
                lcpElement: lcp ? lcp.element : null,
                domContentLoaded: nav.domContentLoadedEventEnd,
                load: nav.loadEventEnd,
                hydrated,
                longTaskCount: longTasks.length,
                longTaskMs: longTasks.reduce((sum, d) => sum + d, 0),
            }
        })
        return { ...timing, requests, kib: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, v / 1024])) }
    } finally {
        await context.close()
    }
}

const NUMERIC = ["ttfb", "fcp", "lcp", "domContentLoaded", "load", "hydrated", "longTaskCount", "longTaskMs", "requests"]
const output = { runs: RUNS, environment: environment(), chromeVersion: null, profiles: PROFILES, results: {} }

for (const [profileName, profile] of Object.entries(PROFILES)) {
    for (const [pageName, url] of Object.entries(PAGES)) {
        const runs = []
        for (let i = 0; i < RUNS; i++) {
            const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
            try {
                output.chromeVersion = (await browser.version()).replace(/^\D+/, "")
                runs.push(await measure(browser, url, profile))
            } finally {
                await browser.close()
            }
        }
        const summary = Object.fromEntries(NUMERIC.map((k) => [k, stats(runs.map((r) => r[k]))]))
        for (const kind of Object.keys(runs[0].kib)) summary[`kib.${kind}`] = stats(runs.map((r) => r.kib[kind]))
        output.results[`${pageName}.${profileName}`] = { url, perRun: runs, summary }
        const m = (k) => Math.round(summary[k].median)
        console.log(`${pageName} ${profileName}: FCP ${m("fcp")} LCP ${m("lcp")} DCL ${m("domContentLoaded")} load ${m("load")} hydrated ${m("hydrated")} ms`)
    }
}

writeFileSync(path.join(ensureDir(path.join(RESULTS_DIR, "data")), "navigation.json"), JSON.stringify(output, null, 1))
