// usage: node waterfall.mjs <label> <url> <runs>   (applied mobile throttling: 4x CPU, Slow 4G, fresh browser per run)
import puppeteer from "puppeteer-core"; import { writeFileSync } from "node:fs"
const [label, url, runs = "5"] = process.argv.slice(2); const N = +runs
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
// PROFILE=lh reproduces Lighthouse's applied Slow 4G (request latency 150 x 3.75 ms, throughput x 0.9); default is the milder 150 ms profile used by pokebench.mjs
const LH = process.env.PROFILE === "lh"
const THROTTLE = LH ? { offline: false, latency: 150 * 3.75, downloadThroughput: Math.floor(1.6 * 1024 * 0.9 * 1024 / 8), uploadThroughput: Math.floor(750 * 0.9 * 1024 / 8) } : { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]
async function launch() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] }); const p = await b.newPage()
  await p.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 2 })
  const c = await p.createCDPSession(); await c.send("Network.enable"); await c.send("Performance.enable"); await c.send("Network.setCacheDisabled", { cacheDisabled: true })
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await c.send("Network.emulateNetworkConditions", THROTTLE)
  return { b, p, c }
}
async function waterfall() {
  const { b, p, c } = await launch(); const req = new Map(); let t0 = null
  c.on("Network.requestWillBeSent", (e) => { if (t0 === null) t0 = e.timestamp; req.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp, prio: e.request.initialPriority, initiator: e.initiator.type }) })
  c.on("Network.responseReceived", (e) => { const r = req.get(e.requestId); if (r) { r.ttfb = e.timestamp; r.status = e.response.status } })
  c.on("Network.loadingFinished", (e) => { const r = req.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength } })
  await p.evaluateOnNewDocument(() => { window.__lcp = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lcp.push({ t: e.startTime, el: e.element ? e.element.tagName + (e.url ? " " + e.url.split("/").pop() : "") : "" }))).observe({ type: "largest-contentful-paint", buffered: true }); window.__lt = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true }) })
  await p.goto(url, { waitUntil: "load", timeout: 120000 }); await new Promise((r) => setTimeout(r, 2500))
  const info = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const pt = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, e.startTime])); return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: pt["first-contentful-paint"], lcp: window.__lcp.at(-1), lt: window.__lt } })
  const m = (await c.send("Performance.getMetrics")).metrics; const g = (k) => m.find((x) => x.name === k)?.value
  await b.close()
  const rows = [...req.values()].filter((r) => r.end).map((r) => ({ ...r, s: (r.start - t0) * 1000, e: (r.end - t0) * 1000, w: r.ttfb ? (r.ttfb - r.start) * 1000 : null })).sort((a, z) => a.s - z.s)
  return { rows, ...info, scriptMs: g("ScriptDuration") * 1000, taskMs: g("TaskDuration") * 1000 }
}
const all = []; for (let i = 0; i < N; i++) all.push(await waterfall())
const lcps = all.map((r) => r.lcp?.t ?? 0); const pick = all.find((r) => (r.lcp?.t ?? 0) === med(lcps)) || all[0]
writeFileSync(new URL(`../pokedex/results/waterfall/wf-${LH ? "lh-" : ""}${label}.json`, import.meta.url), JSON.stringify({ label, url, lcps, scriptMsAll: all.map((r) => r.scriptMs), picked: pick }, null, 1))
console.log(label, "LCPs", lcps.map(Math.round).join("/"), "scriptMs", all.map((r) => Math.round(r.scriptMs)).join("/"))
