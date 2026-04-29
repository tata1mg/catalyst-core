---
title: Configuration
slug: configuration
id: configuration
---

# Configuration

Catalyst uses `config/config.json` for all application configuration. This file controls server settings, environment variables, universal app settings, and more.

---

## Configuration File Location

```
project-root/
  └── config/
      └── config.json
```

---

## Server Configuration

### Server Variables

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

## Environment Variables

### Client Variables

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

---

## Universal App Configuration

The `WEBVIEW_CONFIG` object controls universal app settings for iOS and Android.

### App Name

Configure the display name of your application that appears in device launchers, app stores, and system settings.

```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "appName": "My Awesome App"
    },
    "ios": {
      "appName": "My Awesome App"
    }
  }
}
```

---

### Splash Screen

Configure a custom splashscreen for your universal app.

```json
{
  "WEBVIEW_CONFIG": {
    "splashScreen": {
      "duration": 2000,
      "backgroundColor": "#ffffff",
      "imageWidth": 120,
      "imageHeight": 120,
      "cornerRadius": 20
    }
  }
}
```

#### Splash Screen Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `duration` | number | `1000` | Display time in milliseconds |
| `backgroundColor` | string | `"#ffffff"` | Background color (hex) |
| `imageWidth` | number | `120` | Image width in dp/px |
| `imageHeight` | number | `120` | Image height in dp/px |
| `cornerRadius` | number | `20` | Corner radius (0 for square) |

#### Custom Splash Screen Images

**Android**: Place image at `public/android/splashscreen.{png|jpg|webp}`
- Supported formats: PNG, JPG, WebP
- Fallback: App launcher icon

**iOS**: Place image at `public/ios/splashscreen.{png|jpg|jpeg}`
- Recommended: PNG format, 512x512px
- File size: Keep under 1MB
- Fallback: Progress bar with loader

---

### Access Control & Whitelisting

Control network access and navigation in universal apps through URL whitelisting.

```json
{
  "WEBVIEW_CONFIG": {
    "accessControl": {
      "enabled": true,
      "allowedUrls": [
        "https://api.example.com/*",
        "*.example.com",
        "https://cdn.example.com/assets/*"
      ]
    }
  }
}
```

#### Access Control Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable URL whitelisting |
| `allowedUrls` | string[] | `[]` | Permitted URL patterns |

#### Behavior

- **`enabled: true`** — Only whitelisted URLs are accessible (default deny)
- **`enabled: false`** — All URLs are accessible (no restrictions)

#### URL Patterns

**Exact Match:**
```json
{
  "allowedUrls": [
    "https://api.example.com/users",
    "https://cdn.example.com/logo.png"
  ]
}
```

**Wildcard Match:**
```json
{
  "allowedUrls": [
    "https://api.example.com/*",
    "https://*.example.com/api/*"
  ]
}
```

**Subdomain Match:**
```json
{
  "allowedUrls": [
    "*.example.com",
    "*.cdn.example.com"
  ]
}
```

---

### Protocol Configuration

Configure webview protocol settings for your universal app. Control whether the webview uses HTTP or HTTPS protocol.

```json
{
  "WEBVIEW_CONFIG": {
    "useHttps": true
  }
}
```

- **Type**: Boolean
- **Default**: `false`
- **Description**: Controls the protocol used for webview URLs
- **Behavior**:
  - `true`: Uses HTTPS protocol
  - `false`: Uses HTTP protocol

---

## Example Configuration

Here's a complete example configuration file:

```json title="config/config.json"
{
  "NODE_SERVER_HOSTNAME": "localhost",
  "NODE_SERVER_PORT": 3005,
  "WEBPACK_DEV_SERVER_HOSTNAME": "localhost",
  "WEBPACK_DEV_SERVER_PORT": 3006,
  "BUILD_OUTPUT_PATH": "build",
  "PUBLIC_STATIC_ASSET_PATH": "/assets/",
  "PUBLIC_STATIC_ASSET_URL": "http://localhost:3006",
  "NODE_ENV": "development",
  "API_URL": "https://api.example.com",
  "ANALYTICS_ID": "UA-123456",
  "CLIENT_ENV_VARIABLES": ["API_URL", "ANALYTICS_ID"],

  "WEBVIEW_CONFIG": {
    "useHttps": true,
    "android": {
      "appName": "My App"
    },
    "ios": {
      "appName": "My App"
    },
    "accessControl": {
      "enabled": true,
      "allowedUrls": [
        "https://api.example.com/*",
        "*.cdn.example.com"
      ]
    }
    "splashScreen": {
      "duration": 2000,
      "backgroundColor": "#ffffff",
      "imageWidth": 120,
      "imageHeight": 120,
      "cornerRadius": 20
    }
  }
}
```

---

## Best Practices

1. **Never commit secrets** - Use environment-specific config files and add them to `.gitignore`
2. **Use CLIENT_ENV_VARIABLES sparingly** - Only expose what's absolutely necessary to the client
3. **Use HTTPS in production** - Always set `useHttps: true` for production builds
4. **Configure access control** - Enable whitelisting for production apps to enhance security
5. **Optimize splash screen** - Keep duration reasonable and image size under 1MB
