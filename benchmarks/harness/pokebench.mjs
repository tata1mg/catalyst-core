// usage: node pokebench.mjs <label> <url> <runs>
import lighthouse from "lighthouse"
import * as chromeLauncher from "chrome-launcher"
import puppeteer from "puppeteer-core"
import { writeFileSync } from "node:fs"
const [label, url, runs = "5"] = process.argv.slice(2); const N = +runs
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const med = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
const CARD = 'a[href*="/pokemon/"]'
const out = { lhSim: [], lhApplied: [], search: { desktop: [], mobile: [] }, click: { desktop: [], mobile: [] } }

async function lh(extra) {
  const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags: ["--headless=new", "--no-sandbox"] })
  const r = await lighthouse(url, { port: chrome.port, output: "json", onlyCategories: ["performance"], logLevel: "error", ...extra })
  const a = r.lhr.audits, net = a["network-requests"].details.items, js = net.filter((x) => x.resourceType === "Script"), doc = net.find((x) => x.resourceType === "Document")
  await chrome.kill()
  return { perf: Math.round(r.lhr.categories.performance.score * 100), lcp: a["largest-contentful-paint"].numericValue, fcp: a["first-contentful-paint"].numericValue, tbt: a["total-blocking-time"].numericValue, cls: a["cumulative-layout-shift"].numericValue, si: a["speed-index"].numericValue, jsKiB: js.reduce((s, x) => s + (x.transferSize || 0), 0) / 1024, jsCount: js.length, docKiB: (doc?.transferSize || 0) / 1024, reqs: net.length }
}

async function interact(profile, scenario) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--enable-precise-memory-info"] })
  const page = await browser.newPage(); await page.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 2 })
  const cdp = await page.createCDPSession(); await cdp.send("Network.enable"); await cdp.send("Performance.enable")
  if (profile === "mobile") { await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }) }
  let phase = "load"; const bytes = { load: 0, act: 0 }, cnt = { load: 0, act: 0 }
  page.on("response", async (res) => { if (res.request().resourceType() !== "script") return; const b = await res.buffer().then((x) => x.length).catch(() => 0); bytes[phase] += b; cnt[phase]++ })
  await page.goto(url, { waitUntil: "load", timeout: 120000 }); await new Promise((r) => setTimeout(r, 2000))
  const heapOf = async () => { await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize").value / 1048576 }
  const heap0 = await heapOf()
  await page.evaluate(() => { window.__marker = 1; window.__ev = []; window.__lt = []
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__ev.push({ n: e.name, d: e.duration }))).observe({ type: "event", durationThreshold: 16 })
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask" }) })
  await page.waitForSelector(CARD, { timeout: 30000 })
  phase = "act"; const t0 = performance.now(); let navigated = 0
  if (scenario === "search") {
    await page.click('input[type="search"], input[aria-label="Search Pokémon"]')
    await page.keyboard.type("pika", { delay: 0 })
    await page.waitForFunction((s) => document.querySelectorAll(s).length <= 3, { timeout: 30000, polling: "raf" }, CARD)
  } else {
    await page.click(CARD)
    await page.waitForFunction(() => location.pathname.includes("/pokemon/") && document.readyState !== "loading", { timeout: 30000, polling: "raf" })
    navigated = 1
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const total = performance.now() - t0
  await new Promise((r) => setTimeout(r, 1500))
  const survived = await page.evaluate(() => window.__marker === 1).catch(() => false)
  const ev = await page.evaluate(() => ({ ev: window.__ev || [], lt: window.__lt || [] })).catch(() => ({ ev: [], lt: [] }))
  const heap1 = await heapOf(); const nodes = await page.evaluate(() => document.getElementsByTagName("*").length).catch(() => 0)
  await browser.close()
  return { heap0MB: heap0, heap1MB: heap1, jsLoadKiB: bytes.load / 1024, jsLoadCount: cnt.load, jsActKiB: bytes.act / 1024, jsActCount: cnt.act, actMs: total, maxEventMs: Math.max(0, ...ev.ev.map((e) => e.d)), longTaskMs: ev.lt.reduce((a, b) => a + b, 0), fullNav: navigated && !survived ? 1 : 0, nodes }
}

for (let i = 0; i < N; i++) out.lhSim.push(await lh({}))
for (let i = 0; i < N; i++) out.lhApplied.push(await lh({ throttlingMethod: "devtools" }))
for (const sc of ["search", "click"]) for (const pr of ["desktop", "mobile"]) for (let i = 0; i < N; i++) out[sc][pr].push(await interact(pr, sc))
const m = (arr) => Object.fromEntries(Object.keys(arr[0]).map((k) => [k, med(arr.map((x) => x[k]))]))
const sum = { label, lhSim: m(out.lhSim), lhApplied: m(out.lhApplied) }
for (const sc of ["search", "click"]) sum[sc] = { desktop: m(out[sc].desktop), mobile: m(out[sc].mobile) }
writeFileSync(new URL(`./poke-${label}.json`, import.meta.url), JSON.stringify({ sum, raw: out }, null, 1))
console.log("done", label)
