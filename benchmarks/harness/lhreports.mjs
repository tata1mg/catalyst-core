// Writes the median-LCP Lighthouse HTML+JSON report (of N runs) per target and throttling mode.
import lighthouse from "lighthouse"; import * as cl from "chrome-launcher"; import { writeFileSync, mkdirSync } from "node:fs"
const OUT = process.argv[2], N = +(process.argv[3] || 3); mkdirSync(OUT, { recursive: true })
const targets = { "catalyst-1.0.0": "http://localhost:3015/", "catalyst-1.1.0": "http://localhost:3016/", exact: "http://127.0.0.1:8765/", sveltekit: "http://localhost:3030/" }
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for (const [name, url] of Object.entries(targets)) for (const mode of ["simulated", "applied"]) {
  const runs = []
  for (let i = 0; i < N; i++) {
    const ch = await cl.launch({ chromePath: CHROME, chromeFlags: ["--headless=new", "--no-sandbox"] })
    const r = await lighthouse(url, { port: ch.port, output: ["html", "json"], onlyCategories: ["performance"], logLevel: "error", ...(mode === "applied" ? { throttlingMethod: "devtools" } : {}) })
    runs.push({ lcp: r.lhr.audits["largest-contentful-paint"].numericValue, html: r.report[0], json: r.report[1] }); await ch.kill()
  }
  runs.sort((a, b) => a.lcp - b.lcp); const m = runs[Math.floor(N / 2)]
  writeFileSync(`${OUT}/${name}.${mode}.html`, m.html); writeFileSync(`${OUT}/${name}.${mode}.json`, m.json)
  console.log(name, mode, "LCP runs:", runs.map((x) => Math.round(x.lcp)).join("/"), "-> kept", Math.round(m.lcp))
}
