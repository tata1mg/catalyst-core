# Rendering Modes

Every route in Catalyst renders in one of three modes. They trade off how fresh the content is against how cheap it is to serve — pick per route based on whether the content is personalized, semi-dynamic, or truly the same for everyone. PPR and static are explicit per-route opt-ins via `Component.renderMode`; an unset `renderMode` is the streaming default. PPR also needs `PPR_ENABLE: true` in `config.json` (default off), which doubles as its kill switch.

| Mode      | What's cached      | What's fresh per request          | Applies to bots | Data fetching API |
| --------- | ------------------- | ----------------------------------- | ---------------- | ------------------- |
| Streaming | Nothing              | Everything (data + render)          | Yes (always)      | `serverFetcher` / `clientFetcher` |
| PPR       | Document + route skeleton (`pprFallback`) | The whole app, rendered with this request's data | No (bots get streaming) | `serverFetcher` / `clientFetcher`, or `usePPRRouteData()` |
| Static    | The entire page      | Nothing, until cache is refreshed   | Yes               | `serverFetcher` / `clientFetcher` |

## Streaming (default)

The classic path: `serverFetcher` runs on every request, the fully-resolved tree is rendered with `renderToPipeableStream`, and the response streams to the client as it renders. This is what a route gets by default — no `renderMode` to set — and what bot/crawler requests always get regardless of any other mode.

```js
import { useCurrentRouteData } from "catalyst-core"

function LiveOrders() {
    const { data } = useCurrentRouteData()
    return <p>{data.orderCount} orders right now, fetched at {data.fetchedAt}</p>
}

// Runs on every single request — no shell, no cache, the whole page waits
// on this before anything renders.
LiveOrders.serverFetcher = async () => {
    return fetch("/api/live-order-stats").then((res) => res.json())
}

export default LiveOrders
```

Unlike PPR, there's no static/dynamic split here — the entire page is gated on `serverFetcher` resolving, every time. That's the tradeoff: simplest mental model (one fetch, one render, nothing cached), at the cost of paying full data-fetch + render latency on every request, for every visitor. To send the page before a slow API returns, defer that data (next section).

### Deferred data (`defer` + `<Deferred>`)

A fetcher can hand slow work to `defer()` and return without awaiting it. The shell (document, header, the section's fallback) goes out at once, and the section wrapped in `<Deferred>` streams into the same response when its data arrives. It works on the streaming and PPR paths.

```jsx
import { Deferred } from "catalyst-core"

const MyBookings = () => (
    <Deferred name="orders" fallback={<OrdersSkeleton />}>
        <OrdersList />
    </Deferred>
)

MyBookings.serverFetcher = ({ req }, { store, defer }) => {
    store.dispatch(setPageTitle("My Lab Tests")) // goes out with the shell
    defer("orders", store.dispatch(fetchOrders()), {
        stateKeys: ["ordersReducer"],
        onError: (error) => (error?.status_code === 401 ? "/login" : null),
    })
}
```

- `defer(name, promise, { stateKeys, onError })`: `name` is unique per request and matches `<Deferred name>`. The work updates the store itself; `stateKeys` lists the slices it changes, which are handed to the client when it settles. Do not list a slice the shell already rendered (e.g. the header's): it hydrates against the shell's state, so apply data-dependent header changes on mount. `onError(error)` returns the redirect the server would have issued had it waited: a URL (`location.replace`) or `{ redirect, mode: "assign" }` (keeps history; use it for app deep links in a WebView). `javascript:`/`data:` URLs are refused.
- `<Deferred name fallback>`: the shell shows `fallback` and the section streams in when the work settles. Without a matching `defer()` (a client-side navigation, a blocking request) it renders its children as they are, so the page fetches on the client as usual.
- **Blocking requests** await every `defer()` before rendering, so the first response holds the whole page: bots, static routes, `DEFER_STREAMING_ENABLE: false` (the kill switch) and requests for which the app's `isBlockingRequest({ req, res, store })` hook returns `true` (e.g. link-preview scrapers). A failure there is handled like a failed fetcher: its `onError` redirect, otherwise `onFetcherError`.
- **After the shell** the status code and headers are fixed. A failed deferred request is reported to `onDeferredError({ req, res, store, error, name })` (notify only; logged when the hook is absent), the response stays 200 and only `onError`'s redirect is applied, client-side. Meta tags that depend on deferred data are not in the shell. Deferred work must not call `res.cookie` / `res.redirect`.
- **Limits:** sections still pending after `DEFER_TIMEOUT_MS` (15000) render on the client; a client that disconnects stops the render.
- **With PPR:** the resumed app waits only for the fetchers, which no longer wait for deferred work, so the real header renders as soon as they return and each `<Deferred>` section streams in when its own data lands (within `PPR_RESUME_TIMEOUT_MS`).
- `onRenderError` is notify-only: after the shell, a render error inside a Suspense boundary is sent to the client to render and the response still ends. Apps must not end or redirect the response from the hook.

## Partial Prerendering (PPR)

Opt a route in by setting `renderMode` (and optionally a static skeleton) on its component, and turn PPR on with `PPR_ENABLE: true` in `config.json`:

```js
Home.renderMode = "ppr"
Home.pprFallback = <HomeSkeleton /> // what the cached shell shows until the app streams in
```

A PPR response is written in three parts:

1. **Shell**, prerendered once per `pathname | getPPRShellKey()` with `prerenderToNodeStream` and replayed from an in-memory LRU: the document (`<head>`, inlined CSS, preloads) and `pprFallback`. It is written as soon as `App.serverSideFunction` has run, before route data is fetched.
2. **App**, the postponed hole: resumed with `resumeToPipeableStream` when this request's `serverFetcher` data is ready, so existing fetchers work unchanged.
3. **Trailer**: this request's `__INITIAL_STATE__`, router data, rendered `split()` keys, deferred CSS/JS, and any cookies/redirects set after the headers went out (replayed client-side).

The whole app is inside the hole, so the shell never contains request data. Per-request markup in the app's custom Document (CSRF inputs, per-user scripts) must be wrapped in `<PPRDynamic>`; as a guard, a shell that contains a value from the request's cookies is not cached. On the client, wrap the hydrated root in `<PPRHydrationBoundary>` so it has a Suspense boundary at the same position as the server.

```jsx
// server/document.js (custom Document): per-request markup stays out of the shared shell
import { PPRDynamic } from "catalyst-core"

<Body {...props}>
    <PPRDynamic>
        <input type="hidden" id="_csrf" value={csrfToken} />
    </PPRDynamic>
</Body>

// client/index.js
import { PPRHydrationBoundary } from "catalyst-core"

hydrateRoot(container, <PPRHydrationBoundary>{Application}</PPRHydrationBoundary>)
```

On a streaming (non-PPR) response both render their children as they are.

Optional app hooks (`server/index.js`):

| Hook | Purpose |
| --- | --- |
| `getPPRShellKey({ req, res, store, matches })` | Added to the shell cache key for every request property the shell markup depends on (language, platform). Return `null`/`false` to serve the request on the streaming path. |
| `getPPRPreloadKey({ req, res, store })` | Request properties that change image URLs but not the shell (e.g. device pixel ratio). Keys learned LCP image preloads. |
| `beforePPRFlush({ req, res, store })` | Last point to set headers/cookies before the shell is written (e.g. create a CSRF token). Must be synchronous: its return value is not awaited. |

Config (`config.json`): `PPR_ENABLE` (default `false`), `PPR_SHELL_CACHE_MAX` (50), `PPR_SHELL_BUILDS_MAX` (8 shell prerenders at a time; a miss beyond that takes the streaming path), `PPR_RESUME_TIMEOUT_MS` (15000; on timeout the rest renders on the client), `PPR_PRERENDER_SETTLE_MS` (50), `PPR_PROGRESSIVE_CHUNK_SIZE`, `PPR_LEARN_PRELOADS` (default on), `PPR_REVEAL_THROTTLE` (default off: resumed content is revealed without React 19.2's 300 ms batching).

Bots, `getPPRShellKey` returning `null`, a shell that could not be built (retried after 60 s) and `PPR_ENABLE=false` all take the streaming path. Requires React 19.2 (`resume` APIs).

**Behaviour changes on PPR responses:** the status line goes out with the shell, so it is 200 even when `serverFetcher` fails (the app renders its error state; `window.__STATUS_CODE__` has the real code); meta tags that depend on fetcher data arrive in the body.

### `usePPRRouteData()`

Components can also read data with `usePPRRouteData(fetcher)` (React `use()`). It suspends without calling the fetcher while the shell is prerendered, caches per request on the server (never across users), and seeds the client from `window.cachedData` so hydration does not refetch. It works on the streaming path too. `DynamicDataProvider` is kept for compatibility and is a pass-through.

**Caveat:** the cache is keyed by pathname, not per call site. If a route calls it more than once with different fetchers, the second call reuses the first call's result. Fetch everything the route needs in a single call.

## Static (full-page cache)

For content that's genuinely identical for every visitor — marketing pages, pricing, docs — opt a route into full-page caching by setting `renderMode` on its component:

```js
StaticDemo.serverFetcher = async () => {
    return { generatedAt: new Date().toISOString() }
}

StaticDemo.renderMode = "static"
```

The entire page — not just a shell — is rendered once (via `prerenderToNodeStream` with no abort/postpone, so it waits for the whole tree, including `serverFetcher` data, to fully resolve) and cached in full, keyed by pathname plus the sorted query string. Every later request, bots included, runs `App.serverSideFunction` (so its redirects, auth checks and cookies still apply) and then replays those bytes with no data fetch and no render.

The cached page includes the store state of the request that rendered it, so use static mode only for routes whose store holds nothing per-user. As a guard, a page that contains a value from the request's cookies is not cached.

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

PPR and static responses carry an `x-rendering-mode` header useful for debugging which path served a given request. Streaming responses carry **no such header at all**.

| Value                    | Meaning                                                    |
| -------------------------- | ------------------------------------------------------------- |
| *(header absent)*          | Streaming: classic path, rendered fresh, nothing cached        |
| `ppr-miss`                 | PPR: shell built for this request (and cached), app resumed   |
| `ppr-hit`                  | PPR: shell served from cache, app resumed with this request's data |
| `static-cache-miss`        | Static: no cache entry (or dev bypass) — rendered fresh        |
| `static-cache-hit`         | Static: entire response served from cache                     |
