---
title: SSR Lifecycle
slug: ssr-lifecycle
id: ssr-lifecycle
---

# SSR Lifecycle Methods

Catalyst calls lifecycle hooks that you export from `server/index.js`. Each hook is a named export, and every one is optional. New apps from `create-catalyst-app` start with all of them as empty functions, so you can fill in the ones you need and delete the rest.

## Server Hooks

The hooks are listed in the order Catalyst calls them.

| Hook | When it runs | Receives |
|------|--------------|----------|
| `preServerInit` | Once, before the server starts, in dev and production | nothing |
| `onRouteMatch` | On each page request, after the URL is matched to your routes | `{ req, res, matches, store }` |
| `onAppServerSideSuccess` | After `App.serverSideFunction` resolves | `{ req, res, store }` |
| `onAppServerSideError` | After `App.serverSideFunction` throws | `{ req, res, store, error }` |
| `onFetcherSuccess` | After the matched route's `serverFetcher` resolves | `{ req, res, store }` |
| `onFetcherError` | After the matched route's `serverFetcher` fails | `{ req, res, store, error }` |
| `onRenderError` | When React fails to render the page on the server | `{ req, res, store, error }` |
| `onRequestError` | When anything else in the request throws | `{ req, res, error }` |

```javascript title="server/index.js"
export const preServerInit = async () => {
    // Set up the logger, telemetry or connections before the server starts.
}

export const onRouteMatch = ({ req, res }) => {
    if (req.originalUrl.startsWith("/account") && !req.headers.cookie?.includes("session=")) {
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

When `serverFetcher` fails, the page still renders. The status code comes from the error's `status_code` and defaults to 404. When `App.serverSideFunction` throws, the page also still renders, using the error's `status_code` if it has one.

When a hook itself throws, Catalyst logs it and carries on. A failing `preServerInit` is reported as `PROCESS-001`, and a failing request hook as `PROCESS-002`.

## Rendering Flow

Catalyst uses React streaming SSR for the HTML response:

1. The Node server receives the request.
2. Catalyst matches the URL to your routes and calls `onRouteMatch`.
3. `App.serverSideFunction` runs, then the matched route's `serverFetcher`.
4. React renders the document and route tree on the server.
5. HTML is streamed to the browser.
6. The client hydrates the tree and takes over navigation.

For route-level data, see [Data Fetching](/content/data-fetching).
