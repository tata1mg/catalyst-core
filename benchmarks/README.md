# Catalyst vs Expo Exact benchmarks

Reproducible harness and apps behind the discussion on whether moving parts of Catalyst to Rust
(or adopting Exact-style patterns) is worth it. Everything here is measurement code, not product code.

| Path | What it is |
| --- | --- |
| `run-benchmarks.mjs`, `run-deep-benchmarks.mjs` | First-round harness (Chrome DevTools MCP). Needs `CHROME_DEVTOOLS_MCP_BIN` and, for the Rust-binary timing, `EXACT_REPO`. Superseded by `harness/`; kept because `results.json` / `deep-results.json` came from it. |
| `exact-dog-adoption/`, `exact-error-catalog/` | 1:1 Exact ports of `examples/catalyst-core-test` and `examples/error-catalog`. Only the sources are committed; scaffold the rest with `exact new` and drop these files in. |
| `pokedex/` | The same Pokédex written for Catalyst 1.0.0, Catalyst 1.1.0, Exact and SvelteKit. `node pokedex/fetch.mjs` downloads the shared data and sprites; sprites are not committed. `static-server.mjs` serves them on :4000 for all four apps. |
| `pokedex/results/` | Raw JSON from the Pokédex runs (5 runs per profile, medians in `sum`). |
| `pokedex/results/lighthouse/` | Full Lighthouse HTML reports (simulated and applied throttling) for the four Pokédex targets, with a summary table. Regenerate with `harness/lhreports.mjs`. |
| `harness/` | Lighthouse + puppeteer scripts (`npm install` here first). `pokebench.mjs` is the Pokédex runner; `applied.mjs` runs Lighthouse with applied throttling; `activate.mjs` forces Exact's activation; `phases.py` / `vphase.py` time Catalyst's build phases; `load.mjs` is an HTTP/1.1 keep-alive load generator; `t.py` repeats a command and reports min/median/max. |

Notes for anyone re-running: use direct binaries instead of `npx` (it adds ~325 ms), stop other dev servers
first, and compare Lighthouse's simulated numbers with applied throttling (they disagree a lot for
JS-heavy first paints).
