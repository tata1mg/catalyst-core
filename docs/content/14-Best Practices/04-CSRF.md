---
title: Security
slug: security
id: security
---

# Security

Catalyst gives you server hooks, Express middleware, and WebView access control primitives. Use them deliberately. Security work should happen in both the web server layer and the universal app shell configuration.

## Server Baseline

Register security middleware in `server/server.js`. Catalyst calls `addMiddlewares(app)` before routes are registered, which makes it the correct place for headers, auth, rate limits, and request validation.

```javascript title="server/server.js"
import helmet from "helmet";

export const addMiddlewares = (app) => {
  app.use(helmet());
};
```

Recommended controls:

- secure response headers such as CSP, HSTS, and frame protections
- authentication and session validation before protected handlers
- request logging and rate limiting on sensitive endpoints
- strict input validation on every mutating API

## Content-Security-Policy Nonce

Every `<script>` Catalyst renders — critical and deferred JS, the SSR bot/component markers, `FastRefresh`, and the serialized initial state — can carry a per-request CSP nonce. This lets you ship a `script-src` policy without `'unsafe-inline'`. It does not cover CSS: Catalyst's inline `<style>` tags are never nonced, so a `style-src` policy still needs `'unsafe-inline'` (or another approach) if you inline styles.

Enable it via `CSP_NONCE_ENABLE` in `config/config.json`:

```json title="config/config.json"
{
  "CSP_NONCE_ENABLE": true
}
```

It's off by default — no tags change unless you turn it on.

When enabled, Catalyst generates one nonce per request and stores it on `res.locals.cspNonce`. Read it from your own middleware (registered in `addMiddlewares`) to set a matching header:

```javascript title="server/server.js"
export const addMiddlewares = (app) => {
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      `script-src 'self' 'nonce-${res.locals.cspNonce}'`
    );
    next();
  });
};
```

Middleware runs before the document renders, so if you'd rather generate the nonce yourself (e.g. to reuse one already produced by `helmet` or another library), set `res.locals.cspNonce` before the request reaches the renderer — Catalyst reuses it instead of generating a new one, keeping the header and the rendered tags in sync.

Any custom script you add in `server/document.js` needs the same nonce applied by hand — see the `nonce` prop in [Customising Shell](/content/Guides%20and%20Tutorials/customising-shell#props-reference).

## CSRF

Protect every state-changing endpoint. If you use cookie-based auth or forms, apply CSRF protection and send the token back with each mutating request.

Typical pattern:

- issue a CSRF token on the server
- include it in forms or API headers
- reject missing or invalid tokens on POST, PUT, PATCH, and DELETE routes

## Universal App Access Control

For universal apps, lock down outbound navigation and request targets with `WEBVIEW_CONFIG.accessControl`.

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "accessControl": {
      "enabled": true,
      "allowedUrls": [
        "http://localhost:*",
        "*.yourdomain.com*",
        "https://api.yourdomain.com/*"
      ]
    }
  }
}
```

Important behavior:

- if `enabled` is `true` and `allowedUrls` is empty, all URLs are blocked
- if you rely on localhost server transport, include `http://localhost:*`
- whitelist only the domains the app genuinely needs

## Operational Security Practices

- keep secrets out of `CLIENT_ENV_VARIABLES`
- review native permissions before each mobile release
- disable overly broad WebView navigation rules
- audit third-party scripts and SDKs added to `server/document.js`
- rotate signing and API credentials through your deployment process, not through committed config

## Related Docs

- [Adding Express Middlewares](/content/Guides%20and%20Tutorials/adding-express-middlewares)
- [Configuration API](/content/11-API%20Reference/02-Configuration.mdx)
- [Customising Shell](/content/Guides%20and%20Tutorials/customising-shell)
