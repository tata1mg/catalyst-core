---
title: Universal App
slug: universal-app
id: universal-app
---

# Universal App

A Universal App in Catalyst is a single React application that runs as:

- a server-rendered web app
- an Android app (native webview host)
- an iOS app (native webview host)

The philosophy is simple: keep product logic shared, while allowing platform-specific behavior only where it adds user value.

## How It Works

In Catalyst, a universal app is still a web app at its core:

- the UI is the same React application used on the web
- the app still follows the SSR and hydration model
- a native WebView container hosts that app on Android and iOS
- native features are exposed through `WebBridge` and framework hooks

The result is a web-first architecture with native delivery and native capabilities when required.

## Design Principles

- **Shared-first**: Write features once; avoid forked product logic.
- **Performance-first**: SSR for web, optimized startup for native shells.
- **Progressive native**: Add native capabilities through hooks when needed.
- **Operational simplicity**: One repo, one architecture, multi-platform output.

## Core Features

- SSR + hydration model
- Universal routing model
- Server and client fetcher model
- Universal cache management
- Native bridge APIs (camera, file, storage, haptics, notifications)
- Build targets for Android and iOS

## Architecture Overview

1. **Web Layer**: Shared React pages, routes, and SSR output.
2. **Server Layer**: Node server that renders HTML and coordinates route data.
3. **Bridge Layer**: `WebBridge` connects JavaScript to native capabilities.
4. **Native Layer**: Android and iOS shells host the WebView and execute platform APIs.

## Configuration Surface

Universal app behavior is controlled through `WEBVIEW_CONFIG`, including:

- `port`
- `LOCAL_IP`
- `useHttps`
- `accessControl.allowedUrls`
- `splashScreen`
- `notifications.enabled`
- `android.buildOptimisation`
- `ios.appBundleId`

## Start Here

- [First Universal App](/content/Guides%20and%20Tutorials/First%20Universal%20App/first-universal-app)
- [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp)
- [Universal Cache Management](/content/Guides%20and%20Tutorials/First%20Universal%20App/Cache-Management)
- [Android Build Optimization](/content/Best%20Practices/android-build-optimization)
