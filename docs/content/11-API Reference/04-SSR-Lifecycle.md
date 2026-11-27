---
title: SSR Lifecycle
slug: ssr-lifecycle
id: ssr-lifecycle
---

# SSR Lifecycle Methods

Catalyst calls lifecycle hooks that you export from `server/index.js`. Each hook is a named export, and every one is optional. New apps from `create-catalyst-app` start with all of them as empty functions, so you can fill in the ones you need and delete the rest.

Catalyst reads the hooks by name, so a hook placed inside `export default { ... }` is never called. Since 1.2.0, startup prints a warning that names each hook it found there. Move each one to its own export, such as `export const onRouteMatch = ...`.

## Server Hooks

The hooks are listed in the order Catalyst calls them.

| Hook | When it runs | Receives |
|------|--------------|----------|
| `preServerInit` | Once, before the server starts, in dev and production | nothing |
| `onRouteMatch` | On each page request, after the URL is matched to your routes | `{ req, res, matches, store }` |
| `getEarlyHintLinks` | On each page request, after `onRouteMatch`, when `CLOUDFLARE_EARLY_HINTS_ENABLE` is on | `{ req, res, matches }` |
| `onAppServerSideSuccess` | After `App.serverSideFunction` resolves | `{ req, res, store }` |
| `onAppServerSideError` | After `App.serverSideFunction` throws | `{ req, res, store, error }` |
| `onFetcherSuccess` | After the matched route's `serverFetcher` resolves | `{ req, res, store }` |
| `onFetcherError` | When loading the route's data or preparing the page (metadata, assets) fails | `{ req, res, store, error }` |
| `onRenderError` | When React fails to render the page on the server | `{ req, res, store, error }` |
| `onRequestError` | When anything else in the request throws | `{ req, res, error }` |

```javascript title="server/index.js"
export const preServerInit = async () => {
    // Set up the logger, telemetry or connections before the server starts.
}

// One cookie's value from the request, or "" when it is missing.
const readCookie = (req, name) => {
    for (const part of (req.headers.cookie || "").split(";")) {
        const [key, ...value] = part.trim().split("=")
        if (key === name) return value.join("=")
    }
    return ""
}

export const onRouteMatch = ({ req, res }) => {
    // This only checks that a session cookie is there. A real app validates the
    // session on the server, and never logs its value.
    if (req.originalUrl.startsWith("/account") && !readCookie(req, "session")) {
        res.redirect("/login")
    }
}

export const onFetcherError = ({ req, error }) => {
    console.error(`serverFetcher failed for ${req.originalUrl}`, error)
}
```

## Timing

Catalyst waits for `preServerInit`, so async setup is fine there. Values from `config/config.json` are already on `process.env` when it runs.

Catalyst does not wait for the request hooks, from `onRouteMatch` to `onRequestError`. Keep them synchronous. A redirect sent after an `await` arrives after the render has started, so it cannot stop it. Async work such as sending logs is fine as long as the request does not depend on it.

Read the request path from `req.originalUrl`. Inside the hooks `req.path` is always `/`.

If a request hook sends a response, for example with `res.redirect()` or `res.status(401).send()`, Catalyst skips the rest of the request.

## Errors

`onServerError` is also read from `server/index.js`, but it is not called at the moment. Catalyst calls it only when Express passes an error to the `listen` callback, and Express 4 never does. When the port is taken, Catalyst prints its own error and exits.

`onFetcherError` runs when loading the route's data or preparing the page (its metadata and assets) fails during SSR. The page still renders, with the error's `status_code` when the fetcher returned one, and 404 otherwise. When `App.serverSideFunction` throws, the page also still renders, using the error's `status_code` if it has one.

When a hook itself throws, Catalyst logs it and carries on. A failing `preServerInit` is reported as `PROCESS-001`, and a failing request hook as `PROCESS-002`.

## Early Hints links

`getEarlyHintLinks` adds entries to the Early Hints `Link` header (see [Configuration](/content/API%20Reference/configuration-api#early-hints)). Use it for URLs that change per release or per route; fixed entries belong in `EARLY_HINTS_LINKS`. The CDN learns the header from one response and replays it to later visitors of the same URL, so don't return anything derived from the user, session, cookies, A/B bucket or device. It returns an array of `{ url, rel: "preconnect" | "preload", as?, type?, crossorigin?, fetchPriority? }` entries, the same shape as `EARLY_HINTS_LINKS`.

```javascript title="server/index.js"
export const getEarlyHintLinks = ({ req, res, matches }) => [
    { url: "https://cdn.example.com", rel: "preconnect" },
    { url: "https://cdn.example.com/hero.webp", rel: "preload", as: "image" },
]
```

Unlike the other request hooks, Catalyst waits for this one, so it may return a promise; keep it fast, since the response waits too. Its entries go into the header after the route scripts and `EARLY_HINTS_LINKS`, and count against `EARLY_HINTS_MAX_LINK_BYTES`. If it throws or returns something other than an array, it adds nothing and the rest of the header is still sent. Like the other request hooks, a hook that sends a response (for example `res.redirect()`) skips the rest of the request. An entry whose `url`, `as` or `type` holds anything other than visible ASCII (for example an unencoded non-ASCII path or a line break), or `<`, `>` or `"`, is skipped with a warning; percent-encode such paths.

## Rendering Flow

Catalyst uses React streaming SSR for the HTML response:

1. The Node server receives the request.
2. Catalyst matches the URL to your routes and calls `onRouteMatch`.
3. `App.serverSideFunction` runs, then the matched route's `serverFetcher`. Promises passed to `runInParallel` keep running alongside the fetcher (see below).
4. React renders the document and route tree on the server.
5. HTML is streamed to the browser.
6. The client hydrates the tree and takes over navigation.

### Running work alongside the route fetcher

`App.serverSideFunction` receives `runInParallel(...promises)`. Work passed to it starts right away and keeps running while the route's `serverFetcher` runs. Catalyst waits for both before it calls any fetcher hook, renders, or serializes the store.

```javascript
App.serverSideFunction = ({ store, req, res, runInParallel }) => {
    // Starts now and overlaps with the route's serverFetcher.
    runInParallel(store.dispatch(loadUser(req)))
}
```

If a registered promise rejects, the request takes the same path as a rejected `serverSideFunction` and `onAppServerSideError` is called, unless a fetcher already sent a response such as a redirect. Apps that never call `runInParallel` keep the old order.

For route-level data, see [Data Fetching](/content/data-fetching).
