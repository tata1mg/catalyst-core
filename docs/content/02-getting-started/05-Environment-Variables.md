---
title: Environment Variables
slug: environment-variables
id: environment-variables
---

# Environment Variables

Catalyst uses `config/config.json` for configuration. Variables defined here are accessible via `process.env`.

---

## Server Variables

All variables in `config.json` are available on the server through `process.env.VARIABLE_NAME`.

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_SERVER_HOSTNAME` | `"localhost"` | Server hostname |
| `NODE_SERVER_PORT` | `3005` | Server port |
| `WEBPACK_DEV_SERVER_HOSTNAME` | `"localhost"` | Dev server hostname |
| `WEBPACK_DEV_SERVER_PORT` | `3006` | Dev server port |
| `BUILD_OUTPUT_PATH` | `"build"` | Build output directory |
| `PUBLIC_STATIC_ASSET_PATH` | `"/assets/"` | Path for serving static assets |
| `PUBLIC_STATIC_ASSET_URL` | `"http://localhost:3006"` | Base URL for assets (use CDN URL in production) |
| `NODE_ENV` | `"development"` | Node environment |
| `API_URL` | `""` | Base URL for API requests |
| `ANALYZE_BUNDLE` | `false` | Enable webpack bundle analyzer |
| `ENABLE_DEBUG_LOGS` | `false` | Enable debug-level logging |
| `ENABLE_CONSOLE_LOGGING` | `true` | Enable console output |
| `CLIENT_ENV_VARIABLES` | `[]` | Variables to expose to client |

---

## Client Variables

By default, variables are server-only. To expose a variable to client-side code, add its key to the `CLIENT_ENV_VARIABLES` array:

```json title="config/config.json"
{
  "API_URL": "https://api.example.com",
  "ANALYTICS_ID": "UA-123456",
  "SECRET_KEY": "do-not-expose",
  "CLIENT_ENV_VARIABLES": ["API_URL", "ANALYTICS_ID"]
}
```

```javascript
// Client-side usage
const apiUrl = process.env.API_URL;       // "https://api.example.com"
const analyticsId = process.env.ANALYTICS_ID; // "UA-123456"
const secret = process.env.SECRET_KEY;    // undefined (not exposed)
```

> **Security Warning:** Variables in `CLIENT_ENV_VARIABLES` are visible in the browser. Never expose secrets, API keys with write access, or database credentials.
