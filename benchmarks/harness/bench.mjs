// usage: node bench.mjs <label> <url> <runs> [lh|interact|both]
import lighthouse from "lighthouse"
import * as chromeLauncher from "chrome-launcher"
import puppeteer from "puppeteer-core"
import { writeFileSync } from "node:fs"

const [label, url, runs = "5", mode = "both"] = process.argv.slice(2)
const N = +runs
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const med = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
const out = { label, url, lighthouse: [], interact: {} }

if (mode === "lh" || mode === "both") {
    for (let i = 0; i < N; i++) {
        const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags: ["--headless=new", "--no-sandbox"] })
        const r = await lighthouse(url, { port: chrome.port, output: "json", onlyCategories: ["performance"], logLevel: "error" })
        const a = r.lhr.audits
        const net = a["network-requests"].details.items
        const js = net.filter((x) => x.resourceType === "Script")
        out.lighthouse.push({
            perf: Math.round(r.lhr.categories.performance.score * 100),
            lcp: a["largest-contentful-paint"].numericValue, fcp: a["first-contentful-paint"].numericValue,
            tbt: a["total-blocking-time"].numericValue, cls: a["cumulative-layout-shift"].numericValue,
            si: a["speed-index"].numericValue,
            jsKiB: js.reduce((s, x) => s + (x.transferSize || 0), 0) / 1024,
            jsCount: js.length,
        })
        await chrome.kill()
    }
}

async function interactOnce(profile) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--enable-precise-memory-info"] })
    const page = await browser.newPage()
    await page.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 2 })
    const cdp = await page.createCDPSession()
    await cdp.send("Network.enable"); await cdp.send("Performance.enable")
    if (profile === "mobile") {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    }
    let jsBytes = 0, jsCount = 0, phase = "load"; const after = { bytes: 0, count: 0 }
    cdp.on("Network.loadingFinished", () => {})
    page.on("response", async (res) => {
        if (res.request().resourceType() !== "script") return
        const len = +(res.headers()["content-length"] || 0) || (await res.buffer().then((b) => b.length).catch(() => 0))
        if (phase === "load") { jsBytes += len; jsCount++ } else { after.bytes += len; after.count++ }
    })
    await page.goto(url, { waitUntil: "load", timeout: 120000 })
    await new Promise((r) => setTimeout(r, 1500))
    const heapOf = async () => { await cdp.send("HeapProfiler.collectGarbage"); const m = await cdp.send("Performance.getMetrics"); return m.metrics.find((x) => x.name === "JSHeapUsedSize").value }
    const heap0 = await heapOf()
    const paint = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, e.startTime])))
    await page.evaluate(() => {
        window.__ev = []; window.__lt = []; window.__marker = 1
        new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__ev.push({ n: e.name, d: e.duration, delay: e.processingStart - e.startTime }))).observe({ type: "event", durationThreshold: 16, buffered: false })
        new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask" })
    })
    const sel = 'a[href*="/breed/"]'
    await page.waitForSelector(sel, { timeout: 20000 })
    phase = "click"
    let navs = 0; page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs++ })
    const t0 = performance.now()
    await page.click(sel)
    await page.waitForFunction(() => location.pathname.includes("/breed/") && document.readyState !== "loading", { timeout: 30000, polling: "raf" })
    const urlMs = performance.now() - t0
    const domNodes = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.getElementsByTagName("*").length)))))
    const t = { urlMs, paintMs: performance.now() - t0, domNodes }
    await new Promise((r) => setTimeout(r, 1500))
    const ev = await page.evaluate(() => ({ ev: window.__ev || [], lt: window.__lt || [] })).catch(() => ({ ev: [], lt: [] }))
    const markerSurvived = await page.evaluate(() => window.__marker === 1).catch(() => false)
    const heap1 = await heapOf()
    await browser.close()
    return {
        heap0MB: heap0 / 1048576, heap1MB: heap1 / 1048576, jsLoadKiB: jsBytes / 1024, jsLoadCount: jsCount,
        jsAfterClickKiB: after.bytes / 1024, jsAfterClickCount: after.count,
        clickToUrlMs: t.urlMs, clickToPaintMs: t.paintMs, maxEventMs: Math.max(0, ...ev.ev.map((e) => e.d)), maxInputDelayMs: Math.max(0, ...ev.ev.map((e) => e.delay)),
        longTaskMs: ev.lt.reduce((a, b) => a + b, 0), fullNavigation: markerSurvived ? 0 : 1, domNodesAfter: t.domNodes, fcpLoad: paint["first-contentful-paint"] ?? null,
    }
}

if (mode === "interact" || mode === "both") {
    for (const profile of ["desktop", "mobile"]) {
        out.interact[profile] = []
        for (let i = 0; i < N; i++) out.interact[profile].push(await interactOnce(profile))
    }
}

const sum = { label, lh: {}, interact: {} }
if (out.lighthouse.length) for (const k of Object.keys(out.lighthouse[0])) sum.lh[k] = med(out.lighthouse.map((x) => x[k]))
for (const [p, arr] of Object.entries(out.interact)) { sum.interact[p] = {}; for (const k of Object.keys(arr[0])) sum.interact[p][k] = med(arr.map((x) => x[k])) }
writeFileSync(new URL(`./out-${label}.json`, import.meta.url), JSON.stringify({ sum, raw: out }, null, 1))
console.log(JSON.stringify(sum, null, 1))
