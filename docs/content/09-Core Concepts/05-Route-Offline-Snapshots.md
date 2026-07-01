---
title: Route Offline Snapshots
slug: route-offline-snapshots
id: route-offline-snapshots
---

# Route Offline Snapshots

Catalyst can cache SSR HTML snapshots for selected routes so repeat visits can hydrate when the
server or network is unavailable. API responses are still not cached.

## Developer API

Enable route snapshots through route config:

```javascript
{
  path: "/home",
  component: Home,
  offline: true,
}
```

`offline: true` applies to that route and its child URL subtree. Index routes are exact-match only,
so a root index route caches `/` without making every URL eligible. Snapshots are stored by exact
visited URL, so `/home`, `/home?tab=a`, and `/home/settings` are separate cached documents.

## Build Output

Production-style builds generate two Catalyst-owned files in `build/public`:

- `catalyst-offline-manifest.json`
- `catalyst-sw.js`

The manifest contains:

- schema version;
- build id;
- offline route patterns and match regexes.

The build id namespaces caches by `origin + buildId`, so new builds naturally create a fresh cache
space while older snapshots can remain as last-known-good data until cleanup.

## Web Runtime

The browser client registers `/catalyst-sw.js` only in production web builds, not inside native
WebViews.

The service worker:

- fetches and stores the latest offline manifest;
- stores successful SSR HTML for eligible route navigations;
- returns exact cached route snapshots when navigation fetch fails;
- caches intercepted JS, CSS, font, and image requests on demand;
- deletes old Catalyst build caches on service worker activation;
- falls back to `/offline.html` when no route snapshot exists;
- ignores non-GET requests.

## Native Runtime

Android and iOS use native offline cache services instead of the web service worker.

Native request interception:

- refreshes the manifest while online;
- treats main-frame GET document requests under offline route subtrees as snapshot eligible;
- stores successful `text/html` snapshots by exact URL;
- skips background snapshot refresh when the existing snapshot is still fresh;
- sends `X-Catalyst-Offline-Snapshot-Fetch: 1` on native background snapshot fetches;
- serves a cached snapshot when the same URL is requested offline;
- lets API requests and non-GET requests pass through uncached;
- keeps existing `cachePattern` behavior as a global/manual native cache policy;
- adds same-origin GET subresources requested by an active offline route to the native asset cache
  path, while still excluding API and document/data responses where native can identify them.

Use `cachePattern` for cross-origin/CDN assets or custom asset endpoints that native cannot safely
identify as route subresources.

Offline app launch and notification navigation first try a cached route snapshot. If no snapshot is
available, Catalyst falls back to bundled `public/offline.html`.

## Data Clearing

`clearWebData` clears:

- WebView/browser data;
- existing Catalyst asset cache;
- route offline snapshots and cached offline manifest.

Only mark routes `offline: true` when their SSR HTML is public or safe to persist on the device, or
when the app guarantees `clearWebData` on logout and user switch.

## Key Files

- `packages/catalyst-core/src/scripts/generateOfflineManifest.js`
- `packages/catalyst-core/src/offline/registerServiceWorker.js`
- `packages/catalyst-core/src/server/expressServer.js`
- `packages/catalyst-core/src/native/androidProject/app/src/main/java/io/yourname/androidproject/OfflineCacheService.kt`
- `packages/catalyst-core/src/native/iosnativeWebView/Sources/Core/Utils/OfflineCacheService.swift`
- `packages/catalyst-core/src/native/androidProject/app/src/main/java/io/yourname/androidproject/CustomWebview.kt`
- `packages/catalyst-core/src/native/iosnativeWebView/Sources/Core/WebView/WebViewNavigationDelegate.swift`

## Non-Goals

- API response caching
- non-GET request caching
- pre-rendering routes that were never visited
- cross-user route snapshot reuse
