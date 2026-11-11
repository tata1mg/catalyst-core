// usage: node late.mjs <label> <url> <runs> — wait for load + 2.5 s, then tap the search input and type "pika"; Lighthouse applied Slow 4G + 4x CPU
import puppeteer from "puppeteer-core"; import { writeFileSync } from "node:fs"
const [label, url, runs = "5"] = process.argv.slice(2); const N = +runs
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const CARD = 'a[href*="/pokemon/"]', INPUT = 'input[aria-label="Search Pokémon"]'
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]
async function once() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] }); const p = await b.newPage()
  await p.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 2 })
  const c = await p.createCDPSession(); await c.send("Network.enable"); await c.send("Network.setCacheDisabled", { cacheDisabled: true }); await c.send("Performance.enable")
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await c.send("Network.emulateNetworkConditions", { offline: false, latency: 150 * 3.75, downloadThroughput: Math.floor(1.6 * 1024 * 0.9 * 1024 / 8), uploadThroughput: Math.floor(750 * 0.9 * 1024 / 8) })
  let after = 0, on = false; c.on("Network.loadingFinished", (e) => { if (on) after += e.encodedDataLength })
  await p.goto(url, { waitUntil: "load", timeout: 120000 }); await new Promise((r) => setTimeout(r, 2500)); on = true
  const heap = async () => { await c.send("HeapProfiler.collectGarbage"); return (await c.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize").value / 1048576 }
  const h0 = await heap(); const t0 = performance.now()
  await p.click(INPUT); await p.keyboard.type("pika", { delay: 0 })
  await p.waitForFunction((s) => document.querySelectorAll(s).length <= 3, { timeout: 30000, polling: "raf" }, CARD)
  const ms = performance.now() - t0; await new Promise((r) => setTimeout(r, 1500)); const h1 = await heap(); await b.close()
  return { ms, kib: after / 1024, h0, h1 }
}
const all = []; for (let i = 0; i < N; i++) all.push(await once())
writeFileSync(new URL(`../pokedex/results/waterfall/late-${label}.json`, import.meta.url), JSON.stringify({ label, all }, null, 1))
console.log(label.padEnd(10), "tap+type -> filtered:", all.map((r) => Math.round(r.ms)).join("/"), "ms | median", Math.round(med(all.map((r) => r.ms))), "| bytes fetched during:", Math.round(med(all.map((r) => r.kib))), "KiB (transfer) | heap", med(all.map((r) => r.h0)).toFixed(2), "->", med(all.map((r) => r.h1)).toFixed(2), "MB")
