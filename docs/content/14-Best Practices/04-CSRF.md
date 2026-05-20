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
- [Configuration API](/content/11-API%20Reference/02-Configuration.md)
