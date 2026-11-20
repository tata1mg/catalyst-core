# Benchmarking Catalyst

**Proposal.** Catalyst gets a standing benchmark in this repository: a small reference app, built from the catalyst-core on the branch, measured for page load in Chrome under mobile throttling. It produces a table of medians, Lighthouse reports and GIFs of real loads. The first run is done. The results are in [`pokedex/results/README.md`](pokedex/results/README.md), and the harness is in [`harness/`](harness/).

## 1. Problem statement: why benchmark

- **No published numbers.** We have no repeatable figures for how fast a Catalyst app loads. Claims about speed in docs, talks or sales conversations can't be checked.
- **Regressions go unseen.** Releases change the build tooling, the HTML and the hydration path. Nothing tells us whether a release made pages slower.
- **Performance work has no before and after.** The PPR and prehydration experiments on `bench/exact-vs-catalyst` aim to make pages faster. Without a fixed baseline on main we can't show by how much.
- **The earlier exploration can't be reused.** `bench/exact-vs-catalyst` produced useful numbers. But it pinned Catalyst 1.0 and 1.1 from npm, hard-coded four frameworks' ports into its scripts, and was never merged, so it can't be re-run against main.

## 2. How existing benchmarks work

Different benchmarks answer different questions; no single one covers everything.

| Benchmark | What it measures | How |
|---|---|---|
| [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) | Client-side DOM speed: create, update, swap and remove 1,000–10,000 table rows; memory; startup | Drives Chrome and reads durations from the timeline. Weighted geometric mean across tests. |
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring) | One page load: FCP, LCP, TBT, CLS, Speed Index, and a 0–100 score (TBT 30%, LCP 25%, CLS 25%, FCP 10%, SI 10%, the same weights as in our Lighthouse 13.6.0 reports) | Mobile preset with Slow 4G and 4x CPU. [Simulated or applied throttling](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md). Google recommends the [median of 5 runs](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md). |
| [Core Web Vitals](https://web.dev/articles/vitals) | The pass bar: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, judged at the 75th percentile. Also FCP ≤ 1.8 s and TTFB ≤ 0.8 s. | Field data from real users; lab tools approximate it. INP [can't be measured in the lab](https://web.dev/articles/lab-and-field-data-differences). |
| [HTTP Archive Technology Report](https://httparchive.org/reports/techreport/landing) | Share of real sites per framework that pass Core Web Vitals | Chrome UX Report field data. It warns that site complexity, not just the framework, drives the result. |
| [ssr-benchmark](https://github.com/eknkc/ssr-benchmark) | Server render throughput: ops/sec rendering a 1,000-row table | Mock request and response objects, no network and no client bundle, so it measures rendering alone. |
| [HNPWA](https://hnpwa.com/), [RealWorld](https://github.com/gothinkster/realworld) | The same app built in many frameworks | HNPWA reports Lighthouse and WebPageTest numbers per entry. RealWorld fixes the spec, API and CSS. |

Three practices recur across these sources:

- **Fixed reference app.** Use the same small app every run, so changes in the numbers come from the framework, not the app.
- **Repeated runs.** Report the median, plus a percentile such as p75 or p95, never a single run.
- **Explicit conditions.** State the throttling, device and cache state, and separate lab numbers from field numbers.

## 3. Our solution

Catalyst-only for now, set up so other frameworks can be added later.

- **App.** A Pokédex in `benchmarks/pokedex/app/`:
  - The list page has 151 server-rendered cards, a search box and a type filter.
  - The detail page shows one Pokémon.
  - Data comes through `serverFetcher` and `clientFetcher`. Pages are code-split with `split()`. Sprites load from a separate origin.
- **Catalyst version.** The app installs the catalyst-core built from the branch (`npm run sync-core`), so every run measures the code being changed, not an npm release.
- **Measurement.** Both pages are loaded cold in Chrome under two profiles:
  - **Slow 4G + 4x CPU**: Lighthouse's own preset.
  - **Unthrottled**: shows the framework's floor.
- **Metrics:**
  - TTFB, FCP, LCP, DOMContentLoaded, load and hydration
  - JS and HTML bytes, requests, long tasks
  - Lighthouse score, TBT, CLS and Speed Index
- **Output:**
  - A medians table with p75 and max
  - Raw per-run JSON
  - Lighthouse HTML and JSON reports with their filmstrips, and annotated GIFs of a real load at 1x speed. These are generated locally and kept out of git, because they show the Pokémon artwork.
- **Run.** One command: `node harness/run.mjs`, about 10 minutes.

### First results (catalyst-core 1.2.1, Slow 4G + 4x CPU, median of 10)

| | List page | Detail page |
|---|---:|---:|
| First contentful paint | 628 ms | 624 ms |
| Largest contentful paint | 1,164 ms | 1,212 ms |
| DOMContentLoaded | 1,778 ms | 1,714 ms |
| Page load | 1,781 ms | 1,714 ms |
| Hydrated (interactive) | 1,813 ms | 1,741 ms |
| JS transferred | 95 KiB | 95 KiB |
| Lighthouse score (simulated / applied) | 99 / 100 | 100 / 100 |

- **Core Web Vitals.** Both pages pass the lab equivalents. LCP is 1.16–1.21 s with applied throttling and 1.66–2.11 s in Lighthouse's default simulated mode, all under the 2.5 s bar. CLS is 0 and there are no long tasks.
- **Reading the numbers.**
  - TTFB (563 ms) is the emulated network round trip, not server time. Unthrottled, the server answers in 2–5 ms.
  - The LCP element is a sprite image, loaded from a second origin, so LCP includes one more emulated round trip.
- **Visible before interactive.** The list is visible at 1.16 s but doesn't respond until 1.81 s. The browser is still downloading the 58 KiB React bundle on the Slow 4G link, and that download ends at 1,775 ms. DOMContentLoaded, load and hydration all follow it within about 40 ms.
  - Text typed into the search box in that window is lost. We typed "pika" at about 0.67 s, and the box was empty after hydration in 5 of 5 runs.
  - Links still work in that window, as full page loads. A card clicked at about 0.66 s reached the detail page in 5 of 5 runs.
- **Shrinking the window.** Less JS before hydration, or hydrating parts of the page sooner, is the lever. The benchmark can now show what a change like that is worth.

## 4. Use cases covered

| Use case | Covered | How |
|---|---|---|
| Publishable page-load numbers for docs and talks | Yes | Results table, Lighthouse reports, GIFs |
| Catch regressions between releases | Yes | Re-run on a release branch and compare medians; the p75 and max show whether a change is beyond run-to-run noise |
| Before and after for a change (for example the PPR and prehydration experiments) | Yes | Add a variant of the app next to `app/`; the harness takes any URL |
| Compare with other frameworks | Later | Add their Pokédex builds; the harness, conditions and metrics already fit |
| Interaction latency (INP) | No | Needs scripted interactions or field data |
| Server throughput under load (req/s, p99) | No | A separate load test against `catalyst serve` |
| Build time, large apps, real networks and devices | No | Out of scope for a lab page-load benchmark |

## Open questions

- Should the benchmark run in CI on every release, with the medians table committed, or only on demand?
- Which feature should get the first before-and-after variant?
