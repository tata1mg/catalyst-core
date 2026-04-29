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
