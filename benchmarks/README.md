# Catalyst vs Expo Exact benchmarks

Reproducible harness and apps behind the discussion on whether moving parts of Catalyst to Rust
(or adopting Exact-style patterns) is worth it. Everything here is measurement code, not product code.

| Path | What it is |
| --- | --- |
| `run-benchmarks.mjs`, `run-deep-benchmarks.mjs` | First-round harness (Chrome DevTools MCP). Needs `CHROME_DEVTOOLS_MCP_BIN` and, for the Rust-binary timing, `EXACT_REPO`. Superseded by `harness/`; kept because `results.json` / `deep-results.json` came from it. |
| `exact-dog-adoption/`, `exact-error-catalog/` | 1:1 Exact ports of `examples/catalyst-core-test` and `examples/error-catalog`. Only the sources are committed; scaffold the rest with `exact new` and drop these files in. |
| `pokedex/` | The same Pokédex written for Catalyst 1.0.0, Catalyst 1.1.0, Exact and SvelteKit. `node pokedex/fetch.mjs` downloads the shared data and sprites; sprites are not committed. `static-server.mjs` serves them on :4000 for all four apps. |
| `pokedex/results/` | Results, one folder per framework (Lighthouse reports and images, waterfalls, raw data) plus `comparison/` with charts and side-by-side GIFs. See its README. |
| `harness/` | Lighthouse + puppeteer scripts (`npm install` here first). `pokebench.mjs` is the Pokédex runner; `applied.mjs` runs Lighthouse with applied throttling; `activate.mjs` forces Exact's activation; `phases.py` / `vphase.py` time Catalyst's build phases; `load.mjs` is an HTTP/1.1 keep-alive load generator; `t.py` repeats a command and reports min/median/max. |

Notes for anyone re-running: use direct binaries instead of `npx` (it adds ~325 ms), stop other dev servers
first, and compare Lighthouse's simulated numbers with applied throttling (they disagree a lot for
JS-heavy first paints).

### Scripts in `harness/` used for the Pokédex results

All use Lighthouse's own applied Slow 4G profile (request latency 150 x 3.75 ms, 1.6 Mbps x 0.9, 4x CPU), a fresh browser per run, cache disabled. Run `npm install` in `harness/` first (Lighthouse, puppeteer-core, chrome-launcher; the GIFs also need `ffmpeg` and Python Pillow).

| Script | What it does | Output (under `pokedex/results/<framework>/`) |
| --- | --- | --- |
| `lhreports.mjs` | Lighthouse report per target and mode, median-LCP of 3 | `lighthouse.<mode>.html` |
| `extract_lighthouse_images.py` | pulls the filmstrip and screenshots Lighthouse embeds in each report | `lighthouse-images/<mode>/` |
| `waterfall.mjs` (`PROFILE=lh`) | every request with timings and sizes, FCP/LCP/DCL/load, long tasks, main-thread script time; keeps the median-LCP run of 5 | `data/waterfall.json` |
| `early.mjs` | types "pika" at the earliest moment the search box exists | `data/early-typing.json` |
| `late.mjs` | waits for load + 2.5 s, taps the box, types "pika"; bytes fetched split into JS and total | `data/after-load-typing.json` |
| `render.mjs` | prints the kept waterfalls as text | stdout |
| `images.mjs` | draws the waterfall and timeline PNGs, screenshots the report tops | `waterfall.png`, `comparison/` |
| `record.mjs` + `compose.py` | screencast each page under throttling, then composite side-by-side GIFs | `comparison/*.gif` |

Note: `pokebench.mjs` (the first Pokédex runner) used a milder network profile (150 ms latency), so its interaction numbers for Exact are lower than the `late.mjs` ones.
