---
title: SSR Lifecycle
slug: ssr-lifecycle
id: ssr-lifecycle
---

# SSR Lifecycle Methods

Catalyst exposes server lifecycle hooks from `server/index.js` so you can customise app startup, request handling, and SSR error reporting.

## Supported Server Hooks

These hooks are part of the current server hook surface:

| Hook | When it runs | Typical use cases |
|------|--------------|-------------------|
| `preServerInit` | Before the Express server starts | Bootstrapping config, creating DB connections, warming shared services |
| `onRouteMatch` | After the incoming request is matched to a route | Auth checks, redirects, request-scoped setup |
| `onServerError` | When the server hits an uncaught startup error | Logging, alerting, custom process handling |
| `getEarlyHintLinks` | Per rendered request, after `onRouteMatch`, when `CLOUDFLARE_EARLY_HINTS_ENABLE` is on | Adding `preconnect`/`preload` entries to the Early Hints `Link` header |

```javascript title="server/index.js"
export default {
  async preServerInit() {
    // Perform startup work before the server begins accepting traffic.
  },

  async onRouteMatch({ req, res, route }) {
    // Inspect the matched route and request context.
  },

  onServerError(error) {
    // Send the error to your monitoring pipeline.
    console.error(error);
  },
};
```

If you do not need any hooks yet, `export default {}` is valid.

### `getEarlyHintLinks`

Optional. Add it as a named export of `server/index.js`. It receives `{ req, res, matches }` (the matched route list) and returns an array of link entries, or a promise of one. Each entry is `{ url, rel: "preconnect" | "preload", as?, type?, crossorigin?, fetchPriority? }`, the same shape as `EARLY_HINTS_LINKS`. Use it for URLs that change per release or per request; static entries belong in `EARLY_HINTS_LINKS`. A hook that throws or returns something other than an array adds nothing, and the rest of the header is still sent.

```javascript title="server/index.js"
export function getEarlyHintLinks({ req, res, matches }) {
  return [
    { url: "https://cdn.example.com", rel: "preconnect" },
    { url: "https://cdn.example.com/hero.webp", rel: "preload", as: "image" },
  ];
}
```

The entries go into the header after the route scripts and `EARLY_HINTS_LINKS`, and count against `EARLY_HINTS_MAX_LINK_BYTES`. See [Configuration](/content/configuration-api#early-hints).

## Rendering Flow

Catalyst uses React 18 streaming SSR for the main HTML response. The high-level flow is:

1. The Node server receives the request.
2. Catalyst matches the request to a route definition.
3. Route data is prepared for SSR.
4. React renders the shell and route tree on the server.
5. HTML is streamed to the browser.
6. The client hydrates the tree and takes over navigation.

## Error Handling During Render

Render failures are surfaced through the server render pipeline and should be handled through your logging and monitoring setup. In practice:

- use `onServerError` for startup-level failures
- keep route data fetching defensive
- wire app monitoring in the server process for SSR visibility

For request and route-level data behavior, see [Data Fetching](/content/data-fetching).
