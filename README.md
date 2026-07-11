# Catalyst

Frontend framework with server rendering support for web applications.

## Table of Contents

-   Overview
-   Installation
-   Data Fetching with Catalyst
    -   serverFetcher
    -   clientFetcher
    -   refetch (for data revalidation)
-   Rendering Modes
    -   Streaming (default)
    -   Partial Prerendering (PPR)
    -   Static (full-page cache)
    -   x-rendering-mode reference
-   State Management

## Overview

This package provides a way to proxy your request through your server. It allows you to cache your incoming request to improve your server response time.

## Installation

**System Requirements**

-   Node version 20.4.0 or later
-   macOS and Linux are supported

**Automatic Installation**

-   Run the following commands in the directory where you want to set up the Catalyst app.

```js
npx create-catalyst-app@latest
```

If successful, you will see the following prompts in your terminal.

-   Enter the name of your Catalyst application.
-   Choose state management.
-   Once packages are installed,start the development server by running the following command.

```js
cd project-name && npm run start
```

-   Navigate to http://localhost:3005

The dev server should be running now.

Visit our official documentation:
https://catalyst.1mg.com/public_docs/content/installation

## Data Fetching with Catalyst

we have serverFetcher function for fetching with SSR and clientFetcher function for fetching during client side rendering and navigations.

**serverFetcher**

server fetcher will get request, request params, search params and store (if project is setup with redux or rtk) as arguments. We can declare it as an async function and use await for fetching or use then chaining for data fetching.

if server fetcher is called for a route then client fetcher will not be called for that route, unless called with refetch.

```js
Home.serverFetcher = async ({ req, params, searchParams }, { store }) => {
    store.dispatch(someAction())
    const res = await fetch("some_url")
    const json = await res.json()
    return json
}
```

data returned from fetcher function will be accessible through useCurrentRouteData() hook provided by router.

```js
const [data, error, isFetched] = useCurrentRouteData()
```

error and loading state would be handled by router.

**clientFetcher**

client fetcher would be called on client side rendering and client side navigations. `store` would be available as a param in client side for dispatching redux/rtk actions.

```js
Home.clientFetcher = async ({ route, location, params, searchParams, navigate }, { store }) => {
    store.dispatch(someAction())
    const res = await fetch("some_url")
    const json = await res.json()
    return json
}
```

data returned from client fetcher function will be accessible through useCurrentRouteData() hook provided by router (hook for data access through client is same).

```js
const [data, error, isFetched] = useCurrentRouteData()
```

**refetch (for data revalidation)**

refetch function can be used were we need to execute clientFetcher based on some condition(such as for infinite scroll or some state change inside container or onClick.)

We can pass arguments in refetch function which would

```js
const [data,error,isFetched,refetch] = useCurrentRouteData()

useEffect(()=>{
  refetch({refetchArgument:some_value})
},[arg])

clientFetcher = ({},{refetchArgument}) => {

  const res = await api_call // refetchArg can be used as a param in api call
  return res
}

```

## Rendering Modes

Every route renders in one of three modes. They trade off how fresh the content is against how cheap it is to serve — pick per route based on whether the content is personalized, semi-dynamic, or truly the same for everyone.

| Mode          | What's cached          | What's fresh per request         | Applies to bots |
| ------------- | ----------------------- | --------------------------------- | ---------------- |
| Streaming     | Nothing                 | Everything (data + render)        | Yes (always)     |
| PPR           | Static shell only       | `usePPRRouteData()` boundaries    | No               |
| Static        | The entire page         | Nothing, until cache is refreshed | Yes               |

### Streaming (default)

The classic path: `serverFetcher` runs on every request, the fully-resolved tree is rendered with `renderToPipeableStream`, and the response streams to the client as it renders. This is what a route gets by default, and what bot/crawler requests always get regardless of any other mode.

### Partial Prerendering (PPR)

Enabled globally via `ENABLE_PPR=true` (this is the default). A route's static markup — everything that doesn't read data through `usePPRRouteData()` — is rendered once, cached, and replayed as the shell for every subsequent request. Anything wrapped in `usePPRRouteData()` suspends during that initial prerender, gets cut from the cached shell, and is resolved fresh on every request when the shell resumes.

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

PPR is skipped for bot requests (crawlers get the full streaming path) and for routes opted into static mode (see below), even when `ENABLE_PPR=true`.

### Static (full-page cache)

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

### x-rendering-mode reference

Every response carries an `x-rendering-mode` header useful for debugging which path served a given request:

| Value                     | Meaning                                                      |
| -------------------------- | ------------------------------------------------------------- |
| `1st Req`                  | PPR: first request for this route, shell just got cached      |
| `resumeToPipeableStream`   | PPR: shell served from cache, dynamic content resumed live    |
| `static-cache-miss`        | Static: no cache entry (or dev bypass) — rendered fresh        |
| `static-cache-hit`         | Static: entire response served from cache                     |

## State Management

state management wrappers are defined in stateProvider.js file

store can be configured by manipulating store/index.js as per user requirements (custom middlewares etc can be added in this way.

initial state and request object would be provided in createStore function which will be called on server and client, we use the params to add additional arguments and middlewares in redux store.

```js
const configureStore = (initialState, cookies, requestObj, customHeaders) => {
    const api = fetchInstance
    const store = createStore({
        reducer: rootReducer,
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                thunk: {
                    extraArgument: { api },
                },
            }),
        preloadedState: initialState,
    })
    return store
}

export default configureStore
```

## Documentation

Visit https://catalyst.1mg.com to view the full documentation.
