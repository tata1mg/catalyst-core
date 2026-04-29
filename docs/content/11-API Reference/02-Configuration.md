---
title: Configuration API
slug: configuration-api
id: configuration-api
---

# Configuration API

Catalyst reads runtime and build configuration from `config/config.json`. This page covers the contract that the framework expects. For a guided walkthrough, see [Configuration](/content/02-Guides%20and%20Tutorials/01-First%20Catalyst%20App/04-Configuration.md).

## Top-Level Configuration

These keys are part of the core web runtime:

| Key | Type | Required | Purpose |
|-----|------|----------|---------|
| `NODE_SERVER_HOSTNAME` | `string` | Yes | Hostname for the Node SSR server |
| `NODE_SERVER_PORT` | `number` | Yes | Port for the Node SSR server |
| `WEBPACK_DEV_SERVER_HOSTNAME` | `string` | Yes | Hostname for the webpack dev server |
| `WEBPACK_DEV_SERVER_PORT` | `number` | Yes | Port for the webpack dev server |
| `BUILD_OUTPUT_PATH` | `string` | Yes | Output directory for production assets |
| `PUBLIC_STATIC_ASSET_PATH` | `string` | Yes | Public mount path for static assets |
| `PUBLIC_STATIC_ASSET_URL` | `string` | Yes | Base URL for emitted static assets |
| `CLIENT_ENV_VARIABLES` | `string[]` | Yes | Variables that should be exposed to the client bundle |
| `ANALYZE_BUNDLE` | `boolean` | Yes | Enables bundle analysis output |

Application-specific values such as `API_URL` can also live in this file. They are available on the server through `process.env`.

## Client-Exposed Environment Variables

Catalyst does not expose every config key to browser code automatically. Add the keys you want available on the client to `CLIENT_ENV_VARIABLES`.

```json title="config/config.json"
{
  "API_URL": "https://api.example.com",
  "ANALYTICS_ID": "UA-123456",
  "DATABASE_URL": "postgresql://internal-db",
  "CLIENT_ENV_VARIABLES": ["API_URL", "ANALYTICS_ID"]
}
```

In this example:

- `process.env.API_URL` is available on both server and client.
- `process.env.ANALYTICS_ID` is available on both server and client.
- `process.env.DATABASE_URL` stays server-only.

Keep this list small. Any key included here becomes visible in the client bundle.

## `WEBVIEW_CONFIG`

Universal app settings live under `WEBVIEW_CONFIG` inside the same file.

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "port": "3005",
    "LOCAL_IP": "192.168.0.11",
    "appInfo": "android-5Feb2026-v2.1.0",
    "useHttps": false,
    "accessControl": {
      "enabled": true,
      "allowedUrls": ["*.yourdomain.com*", "http://localhost:*"]
    },
    "android": {
      "appName": "My App",
      "packageName": "com.example.myapp",
      "buildType": "debug",
      "sdkPath": "/Users/yourname/Library/Android/sdk",
      "emulatorName": "Pixel_5_API_30"
    },
    "ios": {
      "appName": "My App",
      "appBundleId": "com.example.myapp",
      "buildType": "Debug",
      "simulatorName": "iPhone 17 Pro"
    },
    "splashScreen": {
      "backgroundColor": "#ffffff",
      "duration": 2000,
      "imageWidth": 400,
      "imageHeight": 200,
      "cornerRadius": 20
    }
  }
}
```

## Required Universal App Fields

### Shared fields

| Key | Required | Notes |
|-----|----------|-------|
| `WEBVIEW_CONFIG.port` | Yes | Port the native WebView should load |
| `WEBVIEW_CONFIG.LOCAL_IP` | Yes | Use your LAN IP, not `localhost` |
| `WEBVIEW_CONFIG.appInfo` | Yes | Build identifier used by native tooling |
| `WEBVIEW_CONFIG.useHttps` | No | Defaults to `false` |

### Android fields

| Key | Required | Notes |
|-----|----------|-------|
| `WEBVIEW_CONFIG.android.sdkPath` | Yes | Absolute path to the Android SDK |
| `WEBVIEW_CONFIG.android.emulatorName` | Yes for debug | Required for emulator-based debug builds |
| `WEBVIEW_CONFIG.android.buildType` | No | `debug` or `release` |
| `WEBVIEW_CONFIG.android.keystoreConfig` | Yes for release | Needed to sign release output |
| `WEBVIEW_CONFIG.android.buildOptimisation` | No | Enables Android build optimisation |

### iOS fields

| Key | Required | Notes |
|-----|----------|-------|
| `WEBVIEW_CONFIG.ios.appBundleId` | Required for distribution | Set this explicitly for release builds |
| `WEBVIEW_CONFIG.ios.buildType` | No | Must be `Debug` or `Release`, case-sensitive |
| `WEBVIEW_CONFIG.ios.simulatorName` | No | Used for simulator builds |
| `WEBVIEW_CONFIG.ios.deviceUDID` | No | For physical device builds |
| `WEBVIEW_CONFIG.ios.developmentTeam` | Required with `deviceUDID` | Apple team ID for signing |

## Access Control

Use `WEBVIEW_CONFIG.accessControl` to whitelist outbound URLs used by the WebView and native request flows.

```json
{
  "WEBVIEW_CONFIG": {
    "accessControl": {
      "enabled": true,
      "allowedUrls": [
        "*.yourdomain.com*",
        "https://api.example.com/*",
        "http://localhost:*"
      ]
    }
  }
}
```

If you enable access control, make sure every required API, CDN, and localhost URL is included.

## Splash Screen

The splash screen configuration belongs inside `WEBVIEW_CONFIG.splashScreen`, not at the top level of `config.json`.

| Key | Type | Notes |
|-----|------|-------|
| `backgroundColor` | `string` | Defaults to white |
| `duration` | `number` | Primarily relevant on iOS |
| `imageWidth` | `number` | Width of the splash asset |
| `imageHeight` | `number` | Height of the splash asset |
| `cornerRadius` | `number` | iOS rounded corners |

Place splash assets at:

- `public/android/splashscreen.{png|jpg|jpeg|gif|bmp|webp}`
- `public/ios/splashscreen.{png|jpg|jpeg}`

## Validation Notes

- Missing required top-level config keys cause startup failures.
- Using `CLIENT_ENV_KEYS` is outdated. The current key is `CLIENT_ENV_VARIABLES`.
- iOS build types are case-sensitive: use `Debug` or `Release`.
- `LOCAL_IP` should be a reachable LAN IP for emulator or device builds.
