// usage: node record.mjs <label> <url> <early|late|load> <outDir>
// Records a real screencast of the page under Lighthouse's applied Slow 4G + 4x CPU, plus measured events and cumulative JS bytes.
import puppeteer from "puppeteer-core"; import { mkdirSync, writeFileSync } from "node:fs"
const [label, url, scenario, OUT] = process.argv.slice(2); mkdirSync(`${OUT}/${label}-${scenario}`, { recursive: true })
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const CARD = 'a[href*="/pokemon/"]', INPUT = 'input[aria-label="Search Pokémon"]'
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] }); const p = await b.newPage()
await p.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 1 })
const c = await p.createCDPSession(); await c.send("Network.enable"); await c.send("Page.enable"); await c.send("Network.setCacheDisabled", { cacheDisabled: true })
await c.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await c.send("Network.emulateNetworkConditions", { offline: false, latency: 150 * 3.75, downloadThroughput: Math.floor(1.6 * 1024 * 0.9 * 1024 / 8), uploadThroughput: Math.floor(750 * 0.9 * 1024 / 8) })
const frames = [], ev = {}, js = [], extra = {}; let off = null, wall0 = null; const types = new Map(); const now = () => Date.now() / 1000
c.on("Network.requestWillBeSent", (e) => { if (off === null) { off = e.wallTime - e.timestamp; wall0 = e.wallTime } types.set(e.requestId, e.type) })
c.on("Network.dataReceived", (e) => { if (types.get(e.requestId) === "Script" && off !== null) js.push({ t: e.timestamp + off, b: e.encodedDataLength }) })
c.on("Page.loadEventFired", () => { ev.load = now() }); c.on("Page.domContentEventFired", () => { ev.dcl = now() })
c.on("Page.screencastFrame", async (f) => { frames.push({ ts: f.metadata.timestamp, data: f.data }); c.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}) })
await c.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 412, maxHeight: 823, everyNthFrame: 1 })
await p.evaluateOnNewDocument(() => { window.__lcp = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lcp.push({ t: e.startTime, el: e.element ? e.element.tagName + (e.url ? " " + e.url.split("/").pop() : "") : "" }))).observe({ type: "largest-contentful-paint", buffered: true }) })
const nav = p.goto(url, { waitUntil: "load", timeout: 120000 }).catch(() => {})
const has = () => p.evaluate((s) => !!document.querySelector(s), INPUT).catch(() => false)
const cards = () => p.evaluate((s) => document.querySelectorAll(s).length, CARD).catch(() => 999)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (scenario === "early") {
  while (!(await has())) await sleep(15); ev.input = now()
  await p.click(INPUT); ev.tapStart = now(); await p.keyboard.type("pika", { delay: 90 }); ev.typed = now()
  while (now() - wall0 < 5.2) { if (!ev.filtered && (await cards()) <= 3) ev.filtered = now(); await sleep(25) }
} else if (scenario === "load") {
  await nav; while (now() - wall0 < 4.6) await sleep(50)
  const info = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const pt = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, e.startTime])); const l = window.__lcp.at(-1); return { origin: performance.timeOrigin / 1000, fcp: pt["first-contentful-paint"], lcp: l && l.t, el: l && l.el, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd } })
  ev.fcp = info.origin + info.fcp / 1000; ev.lcp = info.origin + info.lcp / 1000; ev.dcl = info.origin + info.dcl / 1000; ev.load = info.origin + info.load / 1000; extra.lcpEl = info.el
} else {
  await nav; await sleep(2500); ev.input = wall0 + 0.63 // box has been visible since the first paint
  await sleep(100); await p.click(INPUT); ev.tapStart = now(); const tEnd = ev.tapStart + 3.2
  await p.keyboard.type("pika", { delay: 90 }); ev.typed = now()
  while (now() < tEnd) { if (!ev.filtered && (await cards()) <= 3) ev.filtered = now(); await sleep(25); if (ev.filtered && now() > ev.filtered + 0.9) break }
}
await c.send("Page.stopScreencast"); await b.close()
const files = frames.map((f, i) => { const n = `${OUT}/${label}-${scenario}/f${String(i).padStart(4, "0")}.jpg`; writeFileSync(n, Buffer.from(f.data, "base64")); return { ts: f.ts, file: n } })
writeFileSync(`${OUT}/${label}-${scenario}/meta.json`, JSON.stringify({ label, scenario, wall0, ev, js, extra, frames: files }, null, 1))
const r = (k) => (ev[k] ? Math.round((ev[k] - wall0) * 1000) : null)
console.log(label, scenario, "frames", files.length, "| input", r("input"), "tap", r("tapStart"), "typed", r("typed"), "filtered", r("filtered"), "load", r("load"), "| js KiB", Math.round(js.reduce((a, x) => a + x.b, 0) / 1024))
