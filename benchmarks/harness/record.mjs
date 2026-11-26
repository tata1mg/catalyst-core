// Screen-records one cold load of each page under the slow4g profile and writes an annotated GIF:
// the real frames at 1x speed, a clock, and FCP / LCP / DOMContentLoaded / load / hydration as they happen.
// One recording per page, so the GIF illustrates a typical load; the numbers to quote are in navigation.json.
//
// usage: node record.mjs        (needs ffmpeg on PATH)
import puppeteer from "puppeteer-core"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { CHROME, HEADER_LINK, PAGES, PROFILES, RESULTS_DIR, ensureDir, watchHydration } from "./lib.mjs"

const PROFILE = PROFILES.slow4g
const STEP_MS = 50
const TAIL_MS = 1200
const PHONE = { width: 412, height: 823 }

const EVENTS = [
    ["fcp", "First contentful paint", "#2a9d4a"],
    ["lcp", "Largest contentful paint", "#7b2cbf"],
    ["domContentLoaded", "DOMContentLoaded", "#1f77b4"],
    ["load", "load event", "#d62728"],
    ["hydrated", "hydrated (interactive)", "#b8860b"],
]

async function capture(browser, url) {
    const page = await browser.newPage()
    await page.setViewport({ ...PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
    const cdp = await page.createCDPSession()
    await cdp.send("Network.enable")
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuRate })
    await cdp.send("Network.emulateNetworkConditions", PROFILE.network)

    const frames = []
    cdp.on("Page.screencastFrame", (f) => {
        frames.push({ at: f.metadata.timestamp * 1000, data: f.data })
        cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
    })
    await page.evaluateOnNewDocument(() => {
        window.__bench = Object.assign(window.__bench || {}, { lcp: null })
        new PerformanceObserver((list) => {
            window.__bench.lcp = list.getEntries().at(-1).startTime
        }).observe({ type: "largest-contentful-paint", buffered: true })
    })
    await page.evaluateOnNewDocument(watchHydration, HEADER_LINK)
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 75, maxWidth: PHONE.width, maxHeight: PHONE.height })
    await page.goto(url, { waitUntil: "load", timeout: 120000 })
    await page.waitForFunction(() => window.__bench.hydrated !== null, { timeout: 30000, polling: 50 })
    await new Promise((resolve) => setTimeout(resolve, TAIL_MS))
    await cdp.send("Page.stopScreencast")

    const events = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0]
        const fcp = performance.getEntriesByName("first-contentful-paint")[0]
        return {
            origin: performance.timeOrigin,
            fcp: fcp ? fcp.startTime : null,
            lcp: window.__bench.lcp,
            domContentLoaded: nav.domContentLoadedEventEnd,
            load: nav.loadEventEnd,
            hydrated: window.__bench.hydrated,
        }
    })
    await page.close()
    return { frames: frames.sort((a, b) => a.at - b.at), events }
}

function frameHtml(title, image, t, events) {
    const lines = EVENTS.filter(([key]) => events[key] != null && events[key] <= t)
        .map(([key, label, color]) => `<div style="color:${color}">${Math.round(events[key]).toLocaleString("en")} ms &nbsp;${label}</div>`)
        .join("")
    const shot = image
        ? `<img src="data:image/jpeg;base64,${image}" width="${PHONE.width}" height="${PHONE.height}">`
        : `<div style="width:${PHONE.width}px;height:${PHONE.height}px;background:#fff"></div>`
    return `<html><body style="margin:0;background:#f4f4f4;font:14px system-ui,sans-serif;color:#222">
<div style="display:flex;gap:20px;padding:16px">
  <div style="border:1px solid #bbb;line-height:0">${shot}</div>
  <div style="width:300px">
    <div style="font-size:18px;font-weight:700;margin-bottom:6px">${title}</div>
    <div style="color:#666;font-size:12px;margin-bottom:18px">Real recording at 1x speed. Slow 4G (562 ms RTT, 1.44 Mbps) + 4x CPU slowdown, cold cache.</div>
    <div style="font-size:22px;font-weight:700;margin-bottom:14px">t = ${t.toLocaleString("en")} ms</div>
    <div style="line-height:1.8;font-weight:600">${lines}</div>
  </div>
</div></body></html>`
}

async function render(browser, title, { frames, events }, gifPath) {
    const end = Math.ceil((events.hydrated + TAIL_MS) / STEP_MS) * STEP_MS
    const work = mkdtempSync(path.join(tmpdir(), "catalyst-bench-gif-"))
    const page = await browser.newPage()
    await page.setViewport({ width: PHONE.width + 360, height: PHONE.height + 34 })
    try {
        let index = 0
        for (let t = 0; t <= end; t += STEP_MS) {
            const wall = events.origin + t
            const frame = frames.filter((f) => f.at <= wall).at(-1)
            await page.setContent(frameHtml(title, frame ? frame.data : null, t, events))
            await page.screenshot({ path: path.join(work, `${String(index++).padStart(4, "0")}.png`) })
        }
        const input = path.join(work, "%04d.png")
        const palette = path.join(work, "palette.png")
        const fps = String(1000 / STEP_MS)
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", fps, "-i", input, "-vf", "palettegen=max_colors=128", palette])
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", fps, "-i", input, "-i", palette, "-lavfi", "paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", gifPath])
    } finally {
        await page.close()
        rmSync(work, { recursive: true, force: true })
    }
}

const outDir = ensureDir(path.join(RESULTS_DIR, "gifs"))
const launch = () => puppeteer.launch({ executablePath: CHROME, headless: true })
const summary = {}
for (const [pageName, url] of Object.entries(PAGES)) {
    // A fresh browser per recording: a cold load, and throttling that no earlier page can have reset.
    const recorder = await launch()
    const recording = await capture(recorder, url).finally(() => recorder.close())
    const renderer = await launch()
    const title = `Catalyst Pokédex: ${pageName === "list" ? "list page" : "detail page"} load`
    await render(renderer, title, recording, path.join(outDir, `${pageName}-page-load.gif`)).finally(() => renderer.close())
    const { origin: _origin, ...events } = recording.events
    summary[pageName] = Object.fromEntries(Object.entries(events).map(([k, v]) => [k, v == null ? null : Math.round(v)]))
    console.log(`${pageName}: ${recording.frames.length} frames captured`, JSON.stringify(summary[pageName]))
}
writeFileSync(path.join(outDir, "recorded-events.json"), JSON.stringify(summary, null, 1))
