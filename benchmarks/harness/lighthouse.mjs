// Lighthouse performance audits of each page, N runs per throttling mode, a fresh Chrome per run.
// Keeps the median-LCP run as the published report (HTML + JSON) and its filmstrip frames,
// and writes every run's metrics to results/data/lighthouse.json.
//
// usage: node lighthouse.mjs [runs=5]
import lighthouse from "lighthouse"
import * as chromeLauncher from "chrome-launcher"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { CHROME, PAGES, RESULTS_DIR, ensureDir, runCount, stats } from "./lib.mjs"

const RUNS = runCount(5)

// "simulated" is Lighthouse's default: it loads unthrottled and models Slow 4G + 4x CPU afterwards.
// "applied" throttles the real load in the browser (DevTools throttling), so timings are observed.
const MODES = { simulated: {}, applied: { throttlingMethod: "devtools" } }

const METRICS = {
    score: (lhr) => Math.round(lhr.categories.performance.score * 100),
    ttfb: (lhr) => lhr.audits["server-response-time"].numericValue,
    fcp: (lhr) => lhr.audits["first-contentful-paint"].numericValue,
    lcp: (lhr) => lhr.audits["largest-contentful-paint"].numericValue,
    tbt: (lhr) => lhr.audits["total-blocking-time"].numericValue,
    cls: (lhr) => lhr.audits["cumulative-layout-shift"].numericValue,
    speedIndex: (lhr) => lhr.audits["speed-index"].numericValue,
}

async function audit(url, mode) {
    const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags: ["--headless=new"] })
    try {
        const result = await lighthouse(url, {
            port: chrome.port,
            output: ["html", "json"],
            onlyCategories: ["performance"],
            logLevel: "error",
            ...MODES[mode],
        })
        return result
    } finally {
        await chrome.kill()
    }
}

function saveFilmstrip(lhr, dir) {
    ensureDir(dir)
    for (const frame of lhr.audits["screenshot-thumbnails"].details.items) {
        const name = `${String(Math.round(frame.timing)).padStart(5, "0")}ms.jpg`
        writeFileSync(path.join(dir, name), Buffer.from(frame.data.split(",", 2)[1], "base64"))
    }
}

const lighthouseDir = ensureDir(path.join(RESULTS_DIR, "lighthouse"))
const output = { runs: RUNS, lighthouseVersion: null, chromeVersion: null, results: {} }

for (const [page, url] of Object.entries(PAGES)) {
    for (const mode of Object.keys(MODES)) {
        const runs = []
        for (let i = 0; i < RUNS; i++) {
            const { lhr, report } = await audit(url, mode)
            if (lhr.runtimeError) throw new Error(`${page} ${mode}: ${lhr.runtimeError.message}`)
            output.lighthouseVersion = lhr.lighthouseVersion
            output.chromeVersion = lhr.environment.hostUserAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? null
            const metrics = Object.fromEntries(Object.entries(METRICS).map(([k, read]) => [k, read(lhr)]))
            runs.push({ metrics, lhr, report })
        }

        runs.sort((a, b) => a.metrics.lcp - b.metrics.lcp)
        const kept = runs[Math.floor(runs.length / 2)]
        const base = path.join(lighthouseDir, `${page}.${mode}`)
        writeFileSync(`${base}.report.html`, kept.report[0])
        writeFileSync(`${base}.report.json`, kept.report[1])
        saveFilmstrip(kept.lhr, `${base}.filmstrip`)

        output.results[`${page}.${mode}`] = {
            url,
            perRun: runs.map((r) => r.metrics),
            summary: Object.fromEntries(Object.keys(METRICS).map((k) => [k, stats(runs.map((r) => r.metrics[k]))])),
        }
        const lcps = runs.map((r) => Math.round(r.metrics.lcp)).join("/")
        console.log(`${page} ${mode}: LCP runs ${lcps} ms, kept ${Math.round(kept.metrics.lcp)} ms`)
    }
}

writeFileSync(path.join(ensureDir(path.join(RESULTS_DIR, "data")), "lighthouse.json"), JSON.stringify(output, null, 1))
