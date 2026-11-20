# Catalyst benchmarks

Repeatable page-load measurements of a Catalyst app, built from the catalyst-core in this repository. The app is a small Pokédex: a list of 151 Pokémon with a search box and a type filter, and a detail page per Pokémon. Both pages are server-rendered and hydrate on the client.

Results: [`pokedex/results/README.md`](pokedex/results/README.md). Why this exists and how it compares with other framework benchmarks: [`DISCUSSION.md`](DISCUSSION.md).

| Path | What it is |
|---|---|
| `pokedex/app/` | The Catalyst app. `npm run sync-core` installs the local catalyst-core build instead of the published one. |
| `pokedex/fetch.mjs` | Downloads the sprites into `pokedex/data/sprites/` (not committed). The Pokémon data is committed at `app/server/pokemon.json`. |
| `pokedex/static-server.mjs` | Serves the sprites from `localhost:4000`, a separate origin, so image traffic doesn't count against the Catalyst server. |
| `harness/navigation.mjs` | Cold loads in Chrome via puppeteer. Records TTFB, FCP, LCP, DOMContentLoaded, load, hydration, bytes, requests and long tasks. |
| `harness/lighthouse.mjs` | Lighthouse performance audits, simulated and applied throttling. Keeps the median run's HTML and JSON report and its filmstrip. |
| `harness/early-input.mjs` | Types into the search box and clicks a card before hydration, and records what survives. |
| `harness/record.mjs` | One real Slow 4G load per page, rendered as an annotated GIF at 1x speed. |
| `harness/summary.mjs` | Writes `pokedex/results/README.md` from `pokedex/results/data/*.json`. |
| `harness/run.mjs` | Starts both servers, runs the five scripts above, stops the servers. |

Committed: `pokedex/results/README.md` and `pokedex/results/data/*.json`. The Lighthouse reports, filmstrips and GIFs contain screenshots of the app, which show Pokémon artwork, so `run.mjs` generates them locally under `pokedex/results/` and git ignores them.

## Running it

Needs Node 22, Google Chrome (set `CHROME` if it isn't at the default macOS path) and `ffmpeg` for the GIFs. Stop other dev servers and heavy apps first; they add noise.

```sh
npm ci                                   # repository root, once
cd benchmarks/pokedex/app
npm install && npm run sync-core         # install first, then sync: a later install restores the published package
npm run build
cd .. && node fetch.mjs                  # sprites, once
cd ../harness && npm install
node run.mjs                             # full run, about 10 minutes; --quick does 2 runs each to check the setup
```

Each script also runs on its own against already running servers, for example `node navigation.mjs 20` for 20 runs per page and profile.

## How it measures

- **Conditions.** Every load is cold: a fresh browser per run, cache disabled, 412 × 823 mobile viewport. Two profiles:
  - **slow4g**: Lighthouse's applied Slow 4G (150 ms × 3.75 latency, 1.6 Mbps × 0.9 down) plus 4x CPU slowdown.
  - **unthrottled**: localhost with no throttling. This shows the framework's own floor.
- **Metrics.** Read from the browser's own Performance APIs: Navigation Timing for TTFB, DOMContentLoaded and load; the paint and LCP entries for FCP and LCP; Long Tasks for main-thread blocking.
  - "Hydrated" is the first animation frame in which React has attached its props to the header link. On the list page the search box follows within about 25 ms. Text typed into the box before hydration is lost.
  - Catalyst's template starts hydration on the `load` event, so hydration lands just after load.
- **Statistics.** 10 runs per page and profile for the navigation numbers, reported as median with p75 and max. With 10 runs, a p95 would just be the max, so the table says max. 5 runs per Lighthouse row, reported as the median; Lighthouse's variability guide says a median of 5 is about twice as stable as one run.
- **Lighthouse modes.** Both are reported because they disagree:
  - **simulated** (Lighthouse's default) loads unthrottled and models the slow network afterwards.
  - **applied** throttles the real load.

## Limits

- **Single machine.** Server, sprite server and browser share one machine. The network is emulated, not real, and there is no CDN, TLS or geographic latency.
- **Small app.** The Pokédex is small. The numbers describe a simple list-and-detail site, not a large app.
- **Load only.** These are lab numbers for page load. They don't measure INP (it needs real user interactions), server throughput under load, or build time.
