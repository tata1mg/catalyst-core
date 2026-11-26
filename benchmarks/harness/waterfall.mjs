// Per-request timeline of one cold load per page under slow4g, until the network goes idle: when each request started, got its first
// byte and finished, its size and priority, against FCP, LCP, DOMContentLoaded, load and hydration.
// Loads each page N times, keeps the median-LCP run (the same run the medians table's LCP comes from),
// writes every page's timeline to results/data/waterfall.json and draws it to results/waterfall/<page>.svg.
// The SVG holds only bars and URLs, no screenshots, so it is committed.
//
// usage: node waterfall.mjs [runs=5]
import puppeteer from "puppeteer-core"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { APP_ORIGIN, CHROME, HEADER_LINK, PAGES, PROFILES, RESULTS_DIR, VIEWPORT, ensureDir, environment, medianIndex, runCount, watchHydration } from "./lib.mjs"

const RUNS = runCount(5)
const PROFILE = PROFILES.slow4g

async function load(url) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
    try {
        const page = await browser.newPage()
        await page.setViewport(VIEWPORT)
        const cdp = await page.createCDPSession()
        await cdp.send("Network.enable")
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuRate })
        await cdp.send("Network.emulateNetworkConditions", PROFILE.network)

        // CDP timestamps are monotonic seconds; wallTime (epoch seconds) on requestWillBeSent lets us
        // convert them to ms from the page's navigation start (performance.timeOrigin).
        const requests = new Map()
        let clockOffset = null // wall-clock ms minus monotonic ms
        cdp.on("Network.requestWillBeSent", (e) => {
            if (clockOffset === null) clockOffset = e.wallTime * 1000 - e.timestamp * 1000
            requests.set(e.requestId, { url: e.request.url, type: e.type, priority: e.request.initialPriority, start: e.timestamp * 1000 })
        })
        cdp.on("Network.responseReceived", (e) => {
            const r = requests.get(e.requestId)
            if (r) Object.assign(r, { firstByte: e.timestamp * 1000, status: e.response.status })
        })
        cdp.on("Network.loadingFinished", (e) => {
            const r = requests.get(e.requestId)
            if (r) Object.assign(r, { end: e.timestamp * 1000, bytes: e.encodedDataLength })
        })

        await page.evaluateOnNewDocument(() => {
            window.__bench = Object.assign(window.__bench || {}, { lcp: null })
            new PerformanceObserver((list) => {
                window.__bench.lcp = list.getEntries().at(-1).startTime
            }).observe({ type: "largest-contentful-paint", buffered: true })
        })
        await page.evaluateOnNewDocument(watchHydration, HEADER_LINK)
        await page.goto(url, { waitUntil: "load", timeout: 120000 })
        await page.waitForFunction(() => window.__bench.hydrated !== null, { timeout: 30000, polling: 50 })
        // Every request the load started, including late sprites: wait until the network has been idle for 1 s.
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 60000 })

        const marks = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0]
            const fcp = performance.getEntriesByName("first-contentful-paint")[0]
            return {
                timeOrigin: performance.timeOrigin,
                fcp: fcp ? fcp.startTime : null,
                lcp: window.__bench.lcp,
                domContentLoaded: nav.domContentLoadedEventEnd,
                load: nav.loadEventEnd,
                hydrated: window.__bench.hydrated,
            }
        })
        const fromNav = (t) => (t == null ? null : t + clockOffset - marks.timeOrigin)
        const rows = [...requests.values()]
            .filter((r) => r.end != null)
            .map((r) => ({
                url: r.url,
                type: r.type,
                priority: r.priority,
                status: r.status ?? null,
                start: fromNav(r.start),
                // CDP can stamp responseReceived a hair after loadingFinished for small files; clamp to the end.
                firstByte: r.firstByte == null ? null : fromNav(Math.min(r.firstByte, r.end)),
                end: fromNav(r.end),
                kib: r.bytes / 1024,
            }))
            .sort((a, b) => a.start - b.start)
        const { timeOrigin: _timeOrigin, ...milestones } = marks
        return { milestones, requests: rows }
    } finally {
        await browser.close()
    }
}

// ---- SVG ----
const COLORS = { Document: "#1f77b4", Script: "#d62728", Stylesheet: "#9467bd", Image: "#2a9d4a", Fetch: "#ff7f0e", XHR: "#ff7f0e", Font: "#8c564b" }
const MARKS = [["fcp", "FCP", "#2a9d4a"], ["lcp", "LCP", "#7b2cbf"], ["domContentLoaded", "DCL", "#1f77b4"], ["load", "load", "#d62728"], ["hydrated", "hydrated", "#b8860b"]]
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function label(url) {
    const u = new URL(url)
    const origin = u.origin === new URL(APP_ORIGIN).origin ? "" : `${u.host} `
    const p = u.pathname.length > 46 ? `…${u.pathname.slice(-45)}` : u.pathname
    return `${origin}${p}`
}

function svg(title, { milestones, requests }) {
    const LABEL_W = 330, ROW_H = 14, TOP = 46, PLOT_W = 760, RIGHT = 70
    const maxT = Math.max(...requests.map((r) => r.end), ...Object.values(milestones).filter((v) => v != null))
    const span = Math.ceil(maxT / 250) * 250
    const x = (t) => LABEL_W + (t / span) * PLOT_W
    const plotBottom = TOP + requests.length * ROW_H + 4
    const height = plotBottom + MARKS.length * 12 + 8
    const width = LABEL_W + PLOT_W + RIGHT
    const out = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="ui-monospace, Menlo, monospace" font-size="10">`,
        `<rect width="100%" height="100%" fill="#fff"/>`,
        `<text x="8" y="16" font-size="12" font-weight="bold">${esc(title)}</text>`,
    ]
    for (let t = 0; t <= span; t += 250) {
        out.push(`<line x1="${x(t)}" y1="${TOP - 8}" x2="${x(t)}" y2="${plotBottom}" stroke="#eee"/>`)
        if (t % 500 === 0) out.push(`<text x="${x(t)}" y="${TOP - 12}" text-anchor="middle" fill="#666">${t}</text>`)
    }
    requests.forEach((r, i) => {
        const y = TOP + i * ROW_H
        const color = COLORS[r.type] || "#7f7f7f"
        out.push(`<text x="${LABEL_W - 6}" y="${y + 10}" text-anchor="end" fill="#333">${esc(label(r.url))}</text>`)
        const waitEnd = r.firstByte ?? r.end
        out.push(`<rect x="${x(r.start)}" y="${y + 3}" width="${Math.max(1, x(waitEnd) - x(r.start))}" height="8" fill="${color}" opacity="0.35"/>`)
        out.push(`<rect x="${x(waitEnd)}" y="${y + 3}" width="${Math.max(1, x(r.end) - x(waitEnd))}" height="8" fill="${color}"/>`)
        out.push(`<text x="${x(r.end) + 4}" y="${y + 10}" fill="#666">${r.kib.toFixed(1)} KiB</text>`)
    })
    MARKS.forEach(([key, name, color], i) => {
        const t = milestones[key]
        if (t == null) return
        // one label line per milestone under the plot, so close milestones don't overlap
        const labelY = plotBottom + 12 * (i + 1)
        out.push(`<line x1="${x(t)}" y1="${TOP - 4}" x2="${x(t)}" y2="${labelY - 9}" stroke="${color}" stroke-dasharray="3,2"/>`)
        out.push(`<text x="${x(t) + 3}" y="${labelY}" fill="${color}">${name} ${Math.round(t)} ms</text>`)
    })
    out.push(`<text x="${width - 8}" y="16" text-anchor="end" fill="#666">ms from navigation start · light = waiting for first byte · dark = downloading</text>`)
    out.push("</svg>")
    return out.join("\n")
}

const output = { runs: RUNS, environment: environment(), profile: "slow4g", pages: {} }
const svgDir = ensureDir(path.join(RESULTS_DIR, "waterfall"))
for (const [pageName, url] of Object.entries(PAGES)) {
    const all = []
    for (let i = 0; i < RUNS; i++) all.push(await load(url))
    const sorted = [...all].sort((a, b) => a.milestones.lcp - b.milestones.lcp)
    const kept = sorted[medianIndex(sorted.length)]
    output.pages[pageName] = { url, lcpPerRun: all.map((r) => r.milestones.lcp), ...kept }
    writeFileSync(path.join(svgDir, `${pageName}.svg`), svg(`${pageName} ${new URL(url).pathname} · slow4g + 4x CPU · median-LCP run of ${RUNS}`, kept))
    console.log(`${pageName}: ${kept.requests.length} requests, LCP runs ${all.map((r) => Math.round(r.milestones.lcp)).join("/")} ms, kept ${Math.round(kept.milestones.lcp)} ms`)
}
writeFileSync(path.join(ensureDir(path.join(RESULTS_DIR, "data")), "waterfall.json"), JSON.stringify(output, null, 1))
