---
title: Route Offline Snapshots
slug: route-offline-snapshots
id: route-offline-snapshots
---

# Route Offline Snapshots

Catalyst can cache SSR HTML snapshots for selected routes. After a successful online visit to an
eligible SSR route, Catalyst stores the rendered HTML for that exact URL. If the same URL is opened
later while the server or network is unavailable, Catalyst can serve the cached HTML and hydrate the
page with cached runtime assets.

API responses and non-GET requests are not cached by route offline snapshots.

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

Route eligibility is matched by path. Query strings are ignored for route eligibility, but they are
kept in the snapshot cache key.

Examples:

```javascript
{ path: "/home", offline: true }
// eligible: /home, /home/settings, /home?tab=a

{ path: "/account", children: [{ path: "", offline: true }] }
// eligible: /account
// not eligible: /account/settings

{ path: "/", index: true, offline: true }
// eligible: /
// not every app route
```

## Build Output

Production-style builds generate Catalyst-owned offline runtime files in `build/public`:

- `catalyst-offline-manifest.json`
- `catalyst-sw.js`

If the app provides `public/offline.html`, Catalyst copies it to `build/public/offline.html` and
uses it as the fallback when an eligible route has not been visited online yet.

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
- uses a network-first strategy for eligible route navigations;
- stores successful `text/html` SSR responses by exact URL;
- returns an exact cached route snapshot only when the navigation fetch fails;
- caches intercepted JS, CSS, font, and image requests on demand;
- deletes old Catalyst build caches on service worker activation;
- falls back to `/offline.html` when no route snapshot exists;
- ignores non-GET requests.

## Native Runtime

Android and iOS use native offline cache services instead of the web service worker.

Native request interception:

- refreshes the manifest while online;
- treats main-frame GET document requests under offline route subtrees as snapshot eligible;
- lets the original online WebView navigation continue normally;
- stores successful `text/html` snapshots by exact URL in the background;
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

## Online Recovery

Route snapshots do not replace normal online loading. When the device or browser is online again,
future route reloads, retry actions, and navigations use the network first and refresh the cached
snapshot after a successful response.

If the user is already viewing the bundled offline fallback page, Catalyst does not automatically
reload the page on connectivity recovery. The user must retry, reload, or navigate again for the
online route to load. This avoids unexpectedly replacing visible content or interrupting in-progress
user state during partial connectivity.

Cached JS, CSS, font, and image assets may still be served from the asset cache while fresh or while
being revalidated. API responses and non-GET requests are not served from route offline snapshots.

## Data Clearing

`clearWebData` clears:

- WebView/browser data;
- existing Catalyst asset cache;
- route offline snapshots and cached offline manifest.

Only mark routes `offline: true` when their SSR HTML is public or safe to persist on the device, or
when the app guarantees `clearWebData` on logout and user switch.

## Custom Documents

Native WebView requests include `X-Catalyst-Native-WebView: 1`. Catalyst uses this to expose
`nativeWebView` to the SSR document and to inject `window.__CATALYST_NATIVE_WEBVIEW__` from the
default `<Body />` component.

Apps with a custom `server/document.js` should pass all document props through to Catalyst's
`<Body />`, or explicitly pass `nativeWebView`, so cached native SSR snapshots keep the same native
layout/runtime behavior as online pages:

```jsx title="server/document.js"
import { Head, Body } from "catalyst-core";

export default function Document(props) {
  return (
    <html lang={props.lang}>
      <Head {...props} />
      <Body {...props} />
    </html>
  );
}
```

If a custom document does not render Catalyst's `<Body />`, it must inject the equivalent
`window.__CATALYST_NATIVE_WEBVIEW__` value itself.

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
