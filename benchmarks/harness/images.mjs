// Renders waterfall + interaction-timeline PNGs from pokedex/results/waterfall/*.json, and screenshots of the Lighthouse reports and the apps.
// usage: node harness/images.mjs benchmarks/pokedex/results   (the app screenshots need the four apps running; they are not committed because they show the sprite artwork)
import puppeteer from "puppeteer-core"; import { readFileSync, mkdirSync, existsSync } from "node:fs"; import { pathToFileURL } from "node:url"
const R = process.argv[2], OUT = `${R}/images`; mkdirSync(OUT, { recursive: true })
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const names = { catalyst: "Catalyst 1.1.0", exact: "Exact", sveltekit: "SvelteKit" }
const wf = Object.fromEntries(Object.keys(names).map((k) => [k, JSON.parse(readFileSync(`${R}/waterfall/wf-lh-${k}.json`)).picked]))
const early = Object.fromEntries(Object.keys(names).map((k) => [k, JSON.parse(readFileSync(`${R}/waterfall/early-${k}.json`))]))
const late = Object.fromEntries(Object.keys(names).map((k) => [k, JSON.parse(readFileSync(`${R}/waterfall/late-${k}.json`)).all]))
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]
const XMAX = 4200, LW = 230, CW = 820, W = LW + CW + 40
const x = (ms) => LW + (ms / XMAX) * CW
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
const short = (u) => decodeURIComponent((u.split("/").pop() || "").split("?")[0] || "/").replace(/-[A-Za-z0-9_]{6,}\./, ".")
function chart(k, y0 = 0) {
  const p = wf[k], rows = []; const non = p.rows.filter((r) => r.type !== "Image"), img = p.rows.filter((r) => r.type === "Image")
  for (const r of non) rows.push({ label: `${short(r.url) || "HTML"}`, kib: r.bytes / 1024, s: r.s, e: r.e, c: r.type === "Document" ? "#4c78a8" : r.type === "Script" ? "#e0a030" : r.type === "Stylesheet" ? "#9467bd" : "#999" })
  if (img.length) rows.push({ label: `${img.length} sprite images`, kib: img.reduce((a, r) => a + r.bytes, 0) / 1024, s: Math.min(...img.map((r) => r.s)), e: Math.max(...img.map((r) => r.e)), c: "#b0c4b0" })
  const H = 70 + rows.length * 22 + 36, mk = [["first paint", p.fcp, "#2a9d4a"], ["LCP", p.lcp.t, "#7b2cbf"], ["DOMContentLoaded", p.dcl, "#1f77b4"], ["load", p.load, "#d62728"]]
  let g = `<g transform="translate(0,${y0})"><text x="10" y="22" font-size="17" font-weight="700">${names[k]}</text><text x="10" y="40" font-size="11" fill="#555">Lighthouse applied Slow 4G + 4x CPU, median-LCP run of 5. Main-thread JS ${Math.round(p.scriptMs)} ms. LCP element: ${esc(p.lcp.el)}</text>`
  for (let t = 0; t <= XMAX; t += 500) g += `<line x1="${x(t)}" y1="52" x2="${x(t)}" y2="${52 + rows.length * 22 + 6}" stroke="#eee"/><text x="${x(t)}" y="${64 + rows.length * 22 + 8}" font-size="10" fill="#777" text-anchor="middle">${t}</text>`
  rows.forEach((r, i) => { const y = 58 + i * 22; g += `<text x="${LW - 8}" y="${y + 12}" font-size="11" text-anchor="end">${esc(r.label)} <tspan fill="#888">${r.kib.toFixed(1)} KiB</tspan></text><rect x="${x(r.s)}" y="${y + 2}" width="${Math.max(2, x(r.e) - x(r.s))}" height="14" fill="${r.c}" rx="2"/><text x="${x(r.e) + 4}" y="${y + 13}" font-size="10" fill="#666">${Math.round(r.s)}→${Math.round(r.e)}</text>` })
  mk.forEach(([n, v, c], i) => { if (v == null) return; g += `<line x1="${x(v)}" y1="50" x2="${x(v)}" y2="${58 + rows.length * 22}" stroke="${c}" stroke-width="2" stroke-dasharray="${n === "DOMContentLoaded" ? "4 3" : "0"}"/>` })
  const lab = mk.map(([n, v], i) => `${n} ${Math.round(v)} ms`).join("   |   "); g += `<text x="${LW}" y="${H - 6}" font-size="11" fill="#333">${lab}</text></g>`
  return { g, H }
}
const page = (inner, h) => `<html><body style="margin:0;font-family:system-ui,sans-serif;background:#fff"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}">${inner}</svg></body></html>`
function interaction() {
  const rows = Object.keys(names).map((k) => { const e = early[k].all, m = (f) => med(e.map((r) => r[f]).filter((v) => v != null)); const fl = e.map((r) => r.tFiltered).filter((v) => v != null)
    return { k, input: m("tInput"), typed: m("tTyped"), load: m("tLoad"), filtered: fl.length === e.length ? med(fl) : null, lost: e.filter((r) => r.finalValue === "").length, n: e.length, after: med(late[k].map((r) => r.ms)), kib: med(late[k].map((r) => r.kib)) } })
  const XM = 2600, xx = (ms) => LW + (ms / XM) * CW; let g = `<text x="10" y="24" font-size="17" font-weight="700">Typing "pika" at the earliest moment the search box exists</text><text x="10" y="42" font-size="11" fill="#555">Lighthouse applied Slow 4G + 4x CPU, median of 5 runs. Times are ms from navigation start.</text>`
  rows.forEach((r, i) => { const y = 70 + i * 110
    g += `<text x="10" y="${y + 14}" font-size="14" font-weight="700">${names[r.k]}</text><text x="10" y="${y + 32}" font-size="11" fill="#555">then, typed after load:</text><text x="10" y="${y + 46}" font-size="12" font-weight="700">${Math.round(r.after)} ms to filtered list</text><text x="10" y="${y + 60}" font-size="11" fill="#555">${r.kib.toFixed(0)} KiB fetched</text>`
    g += `<line x1="${LW}" y1="${y + 30}" x2="${xx(XM)}" y2="${y + 30}" stroke="#ccc" stroke-width="3"/>`
    for (let t = 0; t <= XM; t += 500) g += `<text x="${xx(t)}" y="${y + 80}" font-size="10" fill="#777" text-anchor="middle">${t}</text>`
    const dot = (ms, c, lbl, dy) => `<circle cx="${xx(ms)}" cy="${y + 30}" r="6" fill="${c}"/><text x="${xx(ms)}" y="${y + 30 + dy}" font-size="10" text-anchor="middle" fill="#222">${lbl}</text>`
    g += dot(r.input, "#2a9d4a", `box visible ${Math.round(r.input)}`, -12) + dot(r.typed, "#e0a030", `typed ${Math.round(r.typed)}`, 22) + dot(r.load, "#d62728", `load ${Math.round(r.load)}`, -26)
    g += r.filtered ? dot(r.filtered, "#1f77b4", `list filtered ${Math.round(r.filtered)}`, 22) : `<text x="${xx(1900)}" y="${y + 34}" font-size="13" font-weight="700" fill="#d62728">✗ never filtered: text wiped in ${r.lost}/${r.n} runs</text>` })
  return { g, h: 70 + 3 * 110 + 20 }
}
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] }); const shot = async (html, h, f) => { const p = await b.newPage(); await p.setViewport({ width: W, height: h, deviceScaleFactor: 1.5 }); await p.setContent(html); await p.screenshot({ path: `${OUT}/${f}` }); await p.close() }
let y = 0, all = ""; for (const k of Object.keys(names)) { const c = chart(k, y); all += c.g; await shot(page(chart(k, 0).g, c.H), c.H, `waterfall-${k}.png`); y += c.H + 10 }
await shot(page(all, y), y, "waterfalls-all.png"); const it = interaction(); await shot(page(it.g, it.h), it.h, "interaction-timeline.png")
// Lighthouse report screenshots (top of each report)
for (const k of ["catalyst-1.0.0", "catalyst-1.1.0", "exact", "sveltekit"]) for (const m of ["simulated", "applied"]) { const f = `${R}/lighthouse/${k}.${m}.html`; if (!existsSync(f)) continue; const p = await b.newPage(); await p.setViewport({ width: 1100, height: 1400 }); await p.goto(pathToFileURL(f).href, { waitUntil: "load" }); await new Promise((r) => setTimeout(r, 2500)); await p.screenshot({ path: `${OUT}/lighthouse-${k}-${m}.png` }); await p.close() }
// app screenshots
for (const [k, u] of [["catalyst-1.0.0", "http://localhost:3015/"], ["catalyst-1.1.0", "http://localhost:3016/"], ["exact", "http://127.0.0.1:8765/"], ["sveltekit", "http://localhost:3030/"]]) { try { const p = await b.newPage(); await p.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 2 }); await p.goto(u, { waitUntil: "load", timeout: 30000 }); await new Promise((r) => setTimeout(r, 2000)); await p.screenshot({ path: `${OUT}/app-${k}.png` }); await p.close() } catch (e) { console.log("skip app", k, e.message) } }
await b.close(); console.log("done")
