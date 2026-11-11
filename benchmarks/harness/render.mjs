import { readFileSync } from "node:fs"
const names = { catalyst: "Catalyst 1.1.0", exact: "Exact", sveltekit: "SvelteKit" }
for (const l of ["catalyst", "exact", "sveltekit"]) {
  const d = JSON.parse(readFileSync(new URL(`../pokedex/results/waterfall/wf-lh-${l}.json`, import.meta.url))), p = d.picked
  const nonImg = p.rows.filter((r) => r.type !== "Image"), imgs = p.rows.filter((r) => r.type === "Image")
  const end = Math.max(...p.rows.map((r) => r.e), p.lcp?.t || 0, p.load || 0), W = 44, sc = (ms) => Math.round((ms / end) * W)
  const bar = (s, e) => " ".repeat(sc(s)) + "█".repeat(Math.max(1, sc(e) - sc(s)))
  console.log(`\n### ${names[l]}   (picked run: LCP ${Math.round(p.lcp.t)} ms; all 5 runs: ${d.lcps.map(Math.round).join("/")}; main-thread script time ${Math.round(p.scriptMs)} ms)`)
  console.log("start→end ms   KiB  type      name")
  for (const r of nonImg) console.log(`${String(Math.round(r.s)).padStart(5)}→${String(Math.round(r.e)).padEnd(5)}  ${(r.bytes / 1024).toFixed(1).padStart(6)}  ${r.type.padEnd(9)} ${decodeURIComponent(r.url.split("/").pop().split("?")[0] || r.url.replace(/https?:\/\/[^/]+/, "")).slice(0, 28).padEnd(28)} ${bar(r.s, r.e)}`)
  if (imgs.length) { const b = imgs.reduce((s, r) => s + r.bytes, 0) / 1024; console.log(`  + ${imgs.length} image requests (sprites): first starts ${Math.round(Math.min(...imgs.map((r) => r.s)))} ms, last ends ${Math.round(Math.max(...imgs.map((r) => r.e)))} ms, ${b.toFixed(0)} KiB total`) }
  console.log(`markers: FCP ${Math.round(p.fcp)} | LCP ${Math.round(p.lcp.t)} (${p.lcp.el}) | DOMContentLoaded ${Math.round(p.dcl)} | load ${Math.round(p.load)} | long tasks: ${p.lt.length ? p.lt.map(([s, du]) => `${Math.round(s)}+${Math.round(du)}`).join(", ") : "none"}`)
}
