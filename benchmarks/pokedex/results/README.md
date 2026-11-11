# Pokédex results

One folder per framework, plus `comparison/`. Everything here comes from the scripts in `../../harness/`.

```
catalyst-1.0.0/  catalyst-1.1.0/  exact/  sveltekit/
  lighthouse.simulated.html          full Lighthouse report, default (simulated) mobile throttling
  lighthouse.applied.html            full Lighthouse report, throttling applied in the browser
  lighthouse-images/<mode>/          images Lighthouse itself produced, pulled out of the report:
      filmstrip-*.jpg                  8 page-load frames (375 ms apart)
      final-screenshot.jpg               (the full-page screenshot stays inside the HTML report)
  lighthouse-report-top.<mode>.png   screenshot of the top of the report (taken by us)
  waterfall.png                      request waterfall, drawn by us from data/waterfall.json (not in catalyst-1.0.0)
  data/                              raw captures: waterfall.json, early-typing.json, after-load-typing.json
comparison/
  *.gif                                   local only, not committed (see below)
  waterfalls-all.png, interaction-timeline.png, waterfalls.txt
pokebench/                           first Pokédex runner output (5-run medians, milder 150 ms network profile)
```

**What Lighthouse makes and what we drew.** Lighthouse produces the filmstrip and screenshots (the frames and final screenshot are in `lighthouse-images/`). It does not produce a request waterfall image: the `waterfall.png` charts and `interaction-timeline.png` are drawn by `harness/images.mjs` from the captured data.

**The GIFs are recordings, not simulations, and are not committed** (generate them locally with the two scripts below; they land in `comparison/`). `harness/record.mjs` screencasts each page under Lighthouse's applied Slow 4G profile (request latency 562 ms, 1.44 Mbps, 4x CPU slowdown) and logs the measured events; `harness/compose.py` lays them side by side at 1x speed. Each GIF is a single run (the five-run medians are in `data/`). Exact follows the system dark mode, so it renders dark; that does not affect timing.

Each Lighthouse report is the median-LCP run of 3, so values differ slightly from the 5-run medians quoted elsewhere (for example Catalyst 1.0.0 simulated LCP is 2,039 ms here and 2,105 ms in `pokebench/`). Lighthouse 12.8.2..

Servers used: Catalyst 1.0.0 `:3015`, Catalyst 1.1.0 `:3016`, Exact `:8765`, SvelteKit `:3030`, sprites `:4000` (`pokedex/static-server.mjs`).

| Mode | Target | Score | FCP (ms) | LCP (ms) | TBT (ms) | CLS | Speed Index (ms) | Report |
|---|---|---:|---:|---:|---:|---:|---:|---|
| simulated | catalyst-1.0.0 | 99 | 1,664 | 2,039 | 0 | 0 | 1,664 | [report](catalyst-1.0.0/lighthouse.simulated.html) |
| simulated | catalyst-1.1.0 | 99 | 1,660 | 2,035 | 0 | 0 | 1,660 | [report](catalyst-1.1.0/lighthouse.simulated.html) |
| simulated | exact | 100 | 623 | 753 | 0 | 0 | 623 | [report](exact/lighthouse.simulated.html) |
| simulated | sveltekit | 99 | 1,362 | 1,814 | 0 | 0 | 1,362 | [report](sveltekit/lighthouse.simulated.html) |
| applied | catalyst-1.0.0 | 100 | 658 | 1,177 | 0 | 0 | 899 | [report](catalyst-1.0.0/lighthouse.applied.html) |
| applied | catalyst-1.1.0 | 100 | 658 | 1,173 | 0 | 0 | 897 | [report](catalyst-1.1.0/lighthouse.applied.html) |
| applied | exact | 100 | 660 | 1,227 | 0 | 0 | 740 | [report](exact/lighthouse.applied.html) |
| applied | sveltekit | 100 | 1,232 | 1,238 | 0 | 0 | 1,262 | [report](sveltekit/lighthouse.applied.html) |

## Interaction numbers (applied Slow 4G, 5 runs)

| | Catalyst 1.1.0 | Exact | SvelteKit |
|---|---:|---:|---:|
| Typed at the earliest moment: list filtered at | never (text wiped, 5/5) | 2,310 ms | 2,063 ms |
| Typed after load: tap to filtered list | 90 ms | 1,623 ms | 71 ms |
| Fetched during that interaction: JS / all types | 0 / 0 KiB | 66 / 86 KiB | 0 / 13 KiB |

Exact's 86 KiB is `app.js` 53.2 KiB + `input-glue` 12.8 KiB (both brotli) + an 11 KiB stylesheet + 9.5 KiB of images. SvelteKit's 13 KiB is images only.
