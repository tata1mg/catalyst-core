---
title: API Routes & SSR Loopback
slug: api-routes-and-loopback
id: api-routes-and-loopback
---

# API Routes & SSR Loopback

`catalyst-core/api` lets you define an API endpoint once and call it the same way from
anywhere in your app — a browser `fetch`, a `clientFetcher`, or SSR code running on the
server. On the server, a call to your own endpoint skips the network entirely: it's
dispatched as a direct, in-process function call instead of a real HTTP round trip.

This is additive. It does not replace `clientFetcher`/`serverFetcher` or change how
existing routes work — see [File Conventions](./03-File-Conventions.md) for those.
Use it wherever you'd otherwise hand-write an Express route and a matching `fetch` call.

## Defining a route

```javascript title="server/api/breeds.js"
import { defineApi } from "catalyst-core/api";

export const listBreeds = defineApi({
  method: "GET",
  path: "/api/breeds/:id",
  handler: async ({ params, query, body, headers, context }) => {
    return db.getBreed(params.id); // return value -> 200 JSON response
  },
});
```

| Option | Default | Purpose |
|---|---|---|
| `method` | — required | `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` |
| `path` | — required | Express-style path, supports `:param` segments |
| `handler` | — required | `({ params, query, body, headers, context }) => result` |
| `loopback` | `true` | Set `false` to force this route through real HTTP even from SSR — see [When to disable loopback](#when-to-disable-loopback) |
| `unsafeShareResult` | `false` | Skip the safety clone on the returned value — see [Loopback result copying](#loopback-result-copying) |

Throw to produce a non-200 response instead of returning:

```javascript
import { ApiError } from "catalyst-core/api";

handler: async ({ params }) => {
  const breed = await db.getBreed(params.id);
  if (!breed) throw new ApiError(404, { message: "Breed not found" });
  return breed;
};
```

## Registering routes

List every route your app defines in a single `server/api/index.js`:

```javascript title="server/api/index.js"
import { listBreeds } from "./breeds";
import { search } from "./search";

export default [listBreeds, search];
```

Catalyst mounts these on Express automatically, before your app's own middleware, so
they take priority — any broader manual handler you already register (a catch-all
`/api/*`, for example) still runs as a fallback for paths this list doesn't cover. An
app with no `server/api/index.js` is unaffected; this step is entirely optional.

## Calling a route

```javascript
import { api } from "catalyst-core/api";

const breed = await api.get(`/api/breeds/${id}`); // same call, every environment
await api.post("/api/cart", { body: { sku } });
await api.get("/api/search", { query: { q: "beagle" } });
```

`api.get`, `api.post`, `api.put`, `api.patch`, and `api.delete` all accept
`(path, { query, body, headers })`. Use this from a `clientFetcher`/`serverFetcher`, an
event handler, or anywhere else in your app — the same call works unmodified on the
client and the server.

### What happens on each side

- **In the browser**, every call is a normal `fetch` against a relative URL.
- **On the server**, a call to a path defined via `defineApi` is dispatched directly to
  its handler — no socket, no HTTP parsing, no serialization round trip. A same-origin
  path *not* covered by `defineApi` (a route your app added by hand) still resolves
  locally, over real HTTP, rather than failing.
- An absolute/external URL always goes over real `fetch`, in both environments.

None of the dispatch logic ships to the browser bundle — the browser build only ever
takes the `fetch` path.

## Loopback result copying

By default, the value a loopback call returns is deep-cloned before it reaches your
calling code, so mutating it can never corrupt state the handler itself might be
holding onto (an in-memory cache inside a DB client, for example) or leak between
requests. This costs some clone time, but it's still far cheaper than the HTTP
round-trip it replaces.

If a route's handler is proven not to hand back anything shared or mutable, opt out for
a true zero-copy call:

```javascript
defineApi({
  method: "GET",
  path: "/api/breeds/list",
  unsafeShareResult: true,
  handler: () => listBreeds(),
});
```

## When to disable loopback

Set `loopback: false` on a route whose handler needs to stream a response, issue a
redirect, or otherwise do something beyond "return a JSON value" via `context.req`/
`context.res`. Loopback dispatch is for plain request/response handlers only; routes
that need the raw response object should go through the real HTTP path (the browser is
unaffected either way — it always used `fetch`).

## Setting cookies and headers

A loopback handler can set cookies/headers on the real response via `context.res` — but
only while the response is still writable. Once the page has started streaming (SSR has
flushed its shell), headers are already sent, and Catalyst **throws** if a handler
tries to write one after that point rather than dropping it silently. A cookie that
silently fails to set — an auth token, a cart session, an experiment bucket — is the
kind of bug nobody notices until a user reports something subtly broken days later,
so this surfaces immediately at the call site instead.

In practice: keep any route that sets cookies/headers on a code path that runs and
completes before your page starts streaming, not one that resolves later in the
response lifecycle.

## Related Docs

- [File Conventions](./03-File-Conventions.md)
- [SSR Lifecycle](./04-SSR-Lifecycle.md)
