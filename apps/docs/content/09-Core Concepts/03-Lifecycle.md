---
title: Universal App Cache Management
slug: universal-app-cache-management
id: universal-app-cache-management
---

# Universal App Cache Management

Universal apps have more than one cache layer. Catalyst route data, bundled web assets, WebView storage, and native asset caches all behave differently. Treat them as separate systems rather than one generic “app cache.”

## Cache Layers

1. Route/data cache (`serverFetcher`/`clientFetcher` responses)
2. Asset cache (static bundles and media)
3. Device storage cache (native storage APIs)
4. Native custom asset cache (`WebCacheManager` on Android, `CacheManager` on iOS)

## Native Cache Layer

Catalyst universal apps use custom native caches for selected assets. These are separate from built-in WebView storage such as cookies and local storage.

They are configured through `WEBVIEW_CONFIG.*.cachePattern` and are designed for high-value static assets like:

- JavaScript bundles
- CSS
- frequently reused images

## Offline Lifecycle

If `public/offline.html` exists, Catalyst packages it into the native bundles and can show it when connectivity is unavailable. This fallback is served from the native bundle, not from your web server.

That means:

- the offline screen can render even when the server is unreachable
- the page should be self-contained
- retry behavior should be explicit and predictable

## Recommended Strategy

- Cache read-heavy route payloads with clear TTL/versioning.
- Cache static assets through `cachePattern`, not arbitrary dynamic API responses.
- Invalidate or refetch route data after critical writes.
- Keep offline fallback payloads small and deterministic.
- Monitor hit rates and stale-data incidents.

## Operational Notes

- `clearWebData` does not automatically clear the custom native asset caches.
- Cache patterns should match the asset filenames you actually ship.
- If you enable access control, ensure required asset and localhost URLs are still reachable.
- Test cache behavior in release flows, not only in debug mode.

## Related Docs

- [Offline Support](/content/Guides%20and%20Tutorials/First%20Universal%20App/Offline-Support)
- [Universal App Configuration](/content/Guides%20and%20Tutorials/First%20Universal%20App/universal-app-configuration)
