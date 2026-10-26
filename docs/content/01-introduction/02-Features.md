---
title: Features Overview
slug: features-overview
id: features-overview
---

# Features Overview

Catalyst is built around a small set of framework capabilities that work together: SSR, route-aware data loading, a shared web and mobile application model, and production-oriented configuration.

## Server-Side Rendering

- SSR is enabled by default for every route.
- Improves first load performance and crawlability.
- Supports data hydration for smooth client navigation.

[Learn more about SSR →](/content/08-api-reference/04-SSR-Lifecycle.md)

## Universal App Delivery

- Build web, iOS, and Android apps from one React codebase.
- Keep shared business logic while allowing platform-specific UI when needed.
- Use one project for browser and native app delivery with consistent cache behavior across platforms.
- Show an animated HTML splash screen from one `public/splashscreen.html` on Android and iOS while the app loads.

[Learn more about Universal Apps →](/content/introduction/universal-app)

## Routing And Layouts

- Route configuration with nested layouts.
- Predictable SSR + client navigation behavior.
- Clean separation of page and shell concerns.

[Routing →](/content/04-routing/01-Defining-Routes.md)

## Data Fetching Model

- `serverFetcher` for SSR data.
- `clientFetcher` for post-hydration transitions and refresh.
- Route-level data access hooks.

[Data Fetching →](/content/api-reference/data-fetching)

## Native Device APIs

- Camera, files, storage, haptics, notifications, and device info.
- Unified usage model through hooks.
- Platform-aware behavior across Web, iOS, and Android.

[Hooks →](/content/api-reference/hooks)

## Performance And Reliability

- Cache bundled static assets in universal apps, such as JS, CSS, images, and other files matched by `cachePattern`, to improve startup and repeat-load speed.
- Reuse fetched route data on the client through the `serverFetcher` and `clientFetcher` flow so navigation stays fast after hydration.
- Store app-level data in device storage when needed for persistence, offline resilience, and faster resume behavior.

[Performance and Cache Management →](/content/guides-and-tutorials/first-universal-app/configuring-cache-behavior)

## WebMCP (Experimental)

- Expose your app's actions to AI agents running in the browser as named tools.
- Register a tool per action with `useTool()`, or add a `tool` field to a route.
- Built-in `navigate`, `get_current_route` and `get_page_info` tools.

[WebMCP →](/content/webmcp)

## Build And Deployment Readiness

- Optimized production bundles.
- Catalyst app deployment and universal app deployment paths.
- Android build optimization support.

[Deployment →](/content/deployment/catalyst-app-deployment)
