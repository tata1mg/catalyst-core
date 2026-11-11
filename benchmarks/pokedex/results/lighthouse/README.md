# Lighthouse reports (Pokédex, mobile preset)

Open any `.html` file in a browser, or drop it into the [Lighthouse report viewer](https://googlechrome.github.io/lighthouse/viewer/). GitHub shows `.html` files as source, so download first.

Each report is the **median-LCP run of 3** for that target and mode. The discussion quotes medians of 5 runs, so numbers differ slightly (for example Catalyst 1.0.0 simulated LCP is 2,039 ms here and 2,105 ms in the discussion). The `.json` files are not committed because each HTML report embeds its data; regenerate everything with `harness/lhreports.mjs`:

```
node harness/lhreports.mjs benchmarks/pokedex/results/lighthouse 3
```

- **simulated**: Lighthouse's default mobile throttling (what Exact's published numbers use).
- **applied**: `throttlingMethod: "devtools"`, throttling applied in the browser.

Servers: Catalyst 1.0.0 `:3015`, Catalyst 1.1.0 `:3016`, Exact `:8765`, SvelteKit `:3030`, sprites `:4000` (`pokedex/static-server.mjs`). Lighthouse 12.8.2.

| Mode | Target | Score | FCP (ms) | LCP (ms) | TBT (ms) | CLS | Speed Index (ms) | Report |
|---|---|---:|---:|---:|---:|---:|---:|---|
| simulated | catalyst-1.0.0 | 99 | 1,664 | 2,039 | 0 | 0 | 1,664 | [catalyst-1.0.0.simulated.html](catalyst-1.0.0.simulated.html) |
| simulated | catalyst-1.1.0 | 99 | 1,660 | 2,035 | 0 | 0 | 1,660 | [catalyst-1.1.0.simulated.html](catalyst-1.1.0.simulated.html) |
| simulated | exact | 100 | 623 | 753 | 0 | 0 | 623 | [exact.simulated.html](exact.simulated.html) |
| simulated | sveltekit | 99 | 1,362 | 1,814 | 0 | 0 | 1,362 | [sveltekit.simulated.html](sveltekit.simulated.html) |
| applied | catalyst-1.0.0 | 100 | 658 | 1,177 | 0 | 0 | 899 | [catalyst-1.0.0.applied.html](catalyst-1.0.0.applied.html) |
| applied | catalyst-1.1.0 | 100 | 658 | 1,173 | 0 | 0 | 897 | [catalyst-1.1.0.applied.html](catalyst-1.1.0.applied.html) |
| applied | exact | 100 | 660 | 1,227 | 0 | 0 | 740 | [exact.applied.html](exact.applied.html) |
| applied | sveltekit | 100 | 1,232 | 1,238 | 0 | 0 | 1,262 | [sveltekit.applied.html](sveltekit.applied.html) |
