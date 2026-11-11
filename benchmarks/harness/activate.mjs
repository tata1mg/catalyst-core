import puppeteer from "puppeteer-core"
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]
const res = { desktop: [], mobile: [] }
for (const profile of ["desktop", "mobile"]) for (let i = 0; i < 5; i++) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--enable-precise-memory-info"] })
  const p = await b.newPage(); await p.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 2 })
  const c = await p.createCDPSession(); await c.send("Performance.enable"); await c.send("Network.enable")
  if (profile === "mobile") { await c.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await c.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }) }
  let bytes = 0, n = 0, on = false
  p.on("response", async (r) => { if (on && r.request().resourceType() === "script") { n++; bytes += (await r.buffer().catch(() => Buffer.alloc(0))).length } })
  await p.goto("http://127.0.0.1:8765/", { waitUntil: "load" }); await new Promise((r) => setTimeout(r, 1500))
  const heap = async () => { await c.send("HeapProfiler.collectGarbage"); return (await c.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize").value / 1048576 }
  const h0 = await heap(); on = true
  const r = await p.evaluate(async () => {
    let lt = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => (lt += e.duration))).observe({ type: "longtask" })
    const t = performance.now(); await import("./app.js"); const imp = performance.now() - t
    await new Promise((r) => setTimeout(r, 800)); return { imp, lt }
  })
  const h1 = await heap(); await b.close()
  res[profile].push({ activateMs: r.imp, longTaskMs: r.lt, jsKiB: bytes / 1024, jsFiles: n, heapDeltaMB: h1 - h0, heapAfterMB: h1 })
}
for (const k of Object.keys(res)) console.log(k, JSON.stringify(Object.fromEntries(Object.keys(res[k][0]).map((m) => [m, +med(res[k].map((x) => x[m])).toFixed(2)]))))
