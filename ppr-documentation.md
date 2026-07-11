# Rendering Modes

Every route in Catalyst renders in one of three modes. They trade off how fresh the content is against how cheap it is to serve — pick per route based on whether the content is personalized, semi-dynamic, or truly the same for everyone. PPR and static are both explicit per-route opt-ins via `Component.renderMode` — there's no global toggle; an unset `renderMode` is the streaming default.

| Mode      | What's cached      | What's fresh per request          | Applies to bots | Data fetching API |
| --------- | ------------------- | ----------------------------------- | ---------------- | ------------------- |
| Streaming | Nothing              | Everything (data + render)          | Yes (always)      | `serverFetcher` / `clientFetcher` |
| PPR       | Static shell only    | `usePPRRouteData()` boundaries      | No                | `usePPRRouteData()` |
| Static    | The entire page      | Nothing, until cache is refreshed   | Yes               | `serverFetcher` / `clientFetcher` |

## Streaming (default)

The classic path: `serverFetcher` runs on every request, the fully-resolved tree is rendered with `renderToPipeableStream`, and the response streams to the client as it renders. This is what a route gets by default, and what bot/crawler requests always get regardless of any other mode.

## Partial Prerendering (PPR)

Opt a route in by setting `renderMode` on its component:

```js
Home.renderMode = "ppr"
```

A route's static markup — everything that doesn't read data through `usePPRRouteData()` — is rendered once, cached, and replayed as the shell for every subsequent request. Anything wrapped in `usePPRRouteData()` suspends during that initial prerender, gets cut from the cached shell, and is resolved fresh on every request when the shell resumes.

All data fetching on a PPR route goes through [`usePPRRouteData()`/`DynamicDataProvider`](src/web-router/components/DataFetcher.jsx):

```js
import { usePPRRouteData, DynamicDataProvider } from "catalyst-core"
import { Suspense } from "react"

function fetchLiveStats() {
    return fetch("/api/live-stats").then((res) => res.json())
}

function LiveStats() {
    // Suspends on the prerender pass, so this subtree is excluded from the
    // cached shell and re-fetched fresh on every request that resumes it.
    const data = usePPRRouteData(fetchLiveStats)
    return <p>{data.activeUsers} people online</p>
}

function ProductPage() {
    return (
        <div>
            <h1>Static product info — cached in the shell</h1>
            <DynamicDataProvider>
                <Suspense fallback={<p>Loading…</p>}>
                    <LiveStats />
                </Suspense>
            </DynamicDataProvider>
        </div>
    )
}
```

`<DynamicDataProvider>` is required around the dynamic subtree — it's what triggers the abort that cuts that content out of the cached prerender. A route with no `DynamicDataProvider`-wrapped content anywhere has nothing to postpone and is served like any other page; there's no requirement to wrap something dynamic on every route.

**Caveat:** `usePPRRouteData()`'s cache is keyed per-route (by pathname), not per call site. If a route calls it more than once with different fetchers, the second call reuses the first call's cached promise instead of fetching independently. Fetch everything that route needs in a single call (return one combined object) rather than calling `usePPRRouteData()` multiple times on the same page.

PPR is skipped for bot requests (crawlers get the full streaming path) regardless of `renderMode` — a single-pass crawler render doesn't benefit from a shell/dynamic split.

## Static (full-page cache)

For content that's genuinely identical for every visitor — marketing pages, pricing, docs — opt a route into full-page caching by setting `renderMode` on its component:

```js
StaticDemo.serverFetcher = async () => {
    return { generatedAt: new Date().toISOString() }
}

StaticDemo.renderMode = "static"
```

The entire page — not just a shell — is rendered once (via `prerenderToNodeStream` with no abort/postpone, so it waits for the whole tree, including `serverFetcher` data, to fully resolve) and cached in full. Every later request, from bots included, replays those exact bytes with no data fetch and no render at all.

**`serverFetcher`/`clientFetcher` are only discovered on a lazily-loaded route** — `renderMode` and any fetchers must be set on a `split()`-wrapped component, not a plain direct import:

```js
import { split } from "catalyst-core"

const StaticDemo = split(() => import("@containers/StaticDemo/StaticDemo"))
// renderMode has to be mirrored onto the split() wrapper itself — the
// static-mode check is synchronous and can't await the lazy import.
StaticDemo.renderMode = "static"
```

**Refreshing the cache during development:** append `?__refresh_static_cache` to the URL to force one request to bypass the cache and re-render (which also repopulates that route's cache entry with the new output). This only works when `NODE_ENV !== "production"` — in production the query param is ignored and the cached page is always served, since a client-controlled way to force a full re-render would defeat the point of the cache.

The cache is in-process and per-server: it's cleared on restart/redeploy, and (like the PPR shell cache) isn't currently exposed as a public API for a consuming app to clear programmatically at runtime.

## x-rendering-mode reference

Every response carries an `x-rendering-mode` header useful for debugging which path served a given request:

| Value                    | Meaning                                                    |
| -------------------------- | ------------------------------------------------------------- |
| `1st Req`                  | PPR: first request for this route, shell just got cached      |
| `resumeToPipeableStream`   | PPR: shell served from cache, dynamic content resumed live    |
| `static-cache-miss`        | Static: no cache entry (or dev bypass) — rendered fresh        |
| `static-cache-hit`         | Static: entire response served from cache                     |
