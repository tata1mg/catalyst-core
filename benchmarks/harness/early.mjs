// usage: node early.mjs <label> <url> <runs>  — type "pika" at the EARLIEST moment the search input exists; Lighthouse applied Slow 4G + 4x CPU
import puppeteer from "puppeteer-core"; import { writeFileSync } from "node:fs"
const [label, url, runs = "5"] = process.argv.slice(2); const N = +runs
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const CARD = 'a[href*="/pokemon/"]', INPUT = 'input[aria-label="Search Pokémon"]'
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
async function once() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] }); const p = await b.newPage()
  await p.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 2 })
  const c = await p.createCDPSession(); await c.send("Network.enable"); await c.send("Network.setCacheDisabled", { cacheDisabled: true })
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await c.send("Network.emulateNetworkConditions", { offline: false, latency: 150 * 3.75, downloadThroughput: Math.floor(1.6 * 1024 * 0.9 * 1024 / 8), uploadThroughput: Math.floor(750 * 0.9 * 1024 / 8) })
  const reqs = []; let base = null
  c.on("Network.requestWillBeSent", (e) => { if (base === null) base = e.timestamp; if (e.type === "Script") reqs.push({ url: e.request.url.split("/").pop(), s: (e.timestamp - base) * 1000 }) })
  c.on("Network.loadingFinished", (e) => {})
  const t0 = performance.now(); let tLoad = null; const nav = p.goto(url, { waitUntil: "load", timeout: 120000 }).then(() => { tLoad = performance.now() - t0 }).catch(() => {})
  let tInput = null
  while (tInput === null && performance.now() - t0 < 30000) { const has = await p.evaluate((s) => !!document.querySelector(s), INPUT).catch(() => false); if (has) tInput = performance.now() - t0; else await new Promise((r) => setTimeout(r, 20)) }
  await p.click(INPUT).catch(() => {}); const tClick = performance.now() - t0
  await p.keyboard.type("pika", { delay: 0 }); const tTyped = performance.now() - t0
  let tFiltered = null
  while (tFiltered === null && performance.now() - t0 < 25000) { const n = await p.evaluate((s) => document.querySelectorAll(s).length, CARD).catch(() => 999); if (n <= 3) tFiltered = performance.now() - t0; else await new Promise((r) => setTimeout(r, 25)) }
  await nav
  await new Promise((r) => setTimeout(r, 3000))
  const end = await p.evaluate((i, s) => ({ value: document.querySelector(i)?.value ?? null, cards: document.querySelectorAll(s).length }), INPUT, CARD).catch(() => ({}))
  await b.close()
  return { tInput, tClick, tTyped, tFiltered, tLoad, finalValue: end.value, finalCards: end.cards, scripts: reqs.map((r) => `${r.url}@${Math.round(r.s)}`) }
}
const all = []; for (let i = 0; i < N; i++) all.push(await once())
const sum = Object.fromEntries(["tInput", "tTyped", "tFiltered", "tLoad"].map((k) => [k, med(all.map((r) => r[k]))]))
writeFileSync(new URL(`../pokedex/results/waterfall/early-${label}.json`, import.meta.url), JSON.stringify({ label, sum, all }, null, 1))
console.log(label.padEnd(10), "input appears", Math.round(sum.tInput), "| typed", Math.round(sum.tTyped), "| list filtered", sum.tFiltered ? Math.round(sum.tFiltered) : "never (25s)", "| load event", Math.round(sum.tLoad), "| final input value:", all.map((r) => JSON.stringify(r.finalValue)).join(","), "| final cards:", all.map((r) => r.finalCards).join(","))
