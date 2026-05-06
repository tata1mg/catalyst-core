---
title: FAQs
id: faqs
slug: faqs
---

# FAQs

## Where should `config/config.json` live?

Keep the file at `config/config.json` inside the project root. Catalyst reads runtime and build settings from this path.

## Which config keys are mandatory?

At minimum, the web runtime expects keys such as:

- `NODE_SERVER_HOSTNAME`
- `NODE_SERVER_PORT`
- `WEBPACK_DEV_SERVER_HOSTNAME`
- `WEBPACK_DEV_SERVER_PORT`
- `BUILD_OUTPUT_PATH`
- `PUBLIC_STATIC_ASSET_PATH`
- `PUBLIC_STATIC_ASSET_URL`
- `CLIENT_ENV_VARIABLES`
- `ANALYZE_BUNDLE`

For native builds, `WEBVIEW_CONFIG` is also required.

## What is the default app port and when should I change it?

Default app port is usually `3005`. Change it only if:

- another process already uses the port
- your local environment requires a different port
- your team has standard local networking rules

## Why does `LOCAL_IP` matter for universal apps?

`LOCAL_IP` tells the native WebView where to load the local server from. It must be a reachable LAN IP, not `localhost`, because emulators and devices cannot reliably resolve your host machine through `localhost`.

If your IP changes:

1. update `WEBVIEW_CONFIG.LOCAL_IP`
2. restart the Catalyst server
3. rebuild or rerun the universal app

## What does `CLIENT_ENV_VARIABLES` do?

It controls which config values are exposed to the client bundle. Anything not listed remains server-only.

Do not put secrets in `CLIENT_ENV_VARIABLES`.

## How does `accessControl` behave?

`WEBVIEW_CONFIG.accessControl` restricts which URLs the WebView is allowed to load.

- if `enabled` is `true` and `allowedUrls` is empty, all URLs are blocked
- if you use localhost server transport, include `http://localhost:*`
- whitelist only the domains the app genuinely needs

## Why should Android emulator names avoid spaces?

Android CLI tooling can be inconsistent with space-separated names. Prefer names like `pixel7` or `testPhone`.

## How long does emulator setup take?

- First run: usually 2-5 minutes
- Next runs: usually under 1 minute

First setup is slower because SDK and bridge checks are performed.

## Why is iOS `buildType` failing even though the value looks right?

iOS `buildType` is case-sensitive. Use `Debug` or `Release`, not lowercase values.

## Common Errors

- **Port already in use**: switch to a free port.
- **Emulator not found**: verify exact emulator name.
- **Connection refused**: check host/IP and running dev server.
- **Blank or blocked WebView**: check `accessControl.allowedUrls`.
- **Native app cannot reach local server**: verify `LOCAL_IP` and `port`.
- **ADB issues**: restart ADB (`adb kill-server && adb start-server`).
