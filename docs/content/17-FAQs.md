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
- `BUILD_OUTPUT_PATH`
- `PUBLIC_STATIC_ASSET_PATH`
- `PUBLIC_STATIC_ASSET_URL`
- `CLIENT_ENV_VARIABLES`

For native builds, `WEBVIEW_CONFIG` is also required.

## What is the default app port and when should I change it?

Default app port is usually `3005`. Change it only if:

- another process already uses the port
- your local environment requires a different port
- your team has standard local networking rules

## How does the native app reach my dev server?

You do not configure an address for it. Keep `LOCAL_IP` as `localhost`; each debug build works out the address and puts it into the build only:

- Android emulator or USB phone: `localhost`, forwarded to your machine with `adb reverse`
- iOS simulator: `localhost`
- iPhone: your Mac's `<Local Hostname>.local` name, so it keeps working when your IP changes

Apps set up before Catalyst 1.3.0 had a LAN address saved in `config/config.json`. The first build on 1.3.0 puts `localhost` back and prints what it changed. See [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp#how-the-app-reaches-the-dev-server).

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

## Why does `npm run ios` build an IPA instead of opening the simulator?

`WEBVIEW_CONFIG.ios.buildType` is `release` (in any case), which builds the store IPA like `--release` and prints a deprecation warning. Set it to `debug` or remove it, and use `npm run ios:release` for store builds. The same applies to `android.buildType`.

## Common Errors

- **Port already in use**: switch to a free port.
- **Emulator not found**: verify the exact `emulatorName`, or remove it so Catalyst picks or creates one.
- **Connection refused**: check host/IP and running dev server.
- **Blank or blocked WebView**: check `accessControl.allowedUrls`.
- **Native app cannot reach local server**: on Android, check `adb reverse --list`; on an iPhone, check that the Mac and the phone share a Wi-Fi network.
- **ADB issues**: restart ADB (`adb kill-server && adb start-server`).
