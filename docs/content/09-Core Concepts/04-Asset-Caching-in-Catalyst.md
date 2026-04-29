---
title: Caching of Assets in Catalyst
slug: caching-of-assets-in-catalyst
id: caching-of-assets-in-catalyst
---

# Caching of Assets in Catalyst

Catalyst asset caching works differently on the web and in universal apps. On the web, bundling and HTTP caching do most of the work. In universal apps, selected files can also be cached by native code for faster startup and better repeat loads.

## Web Build Layer

The standard web build produces hashed client assets and a server bundle. For web delivery:

- serve emitted assets from `build/public/`
- use a correct `PUBLIC_STATIC_ASSET_URL`
- let immutable hashed assets benefit from long-lived CDN caching

## Universal App Layer

Universal apps can cache selected files through `cachePattern` in `WEBVIEW_CONFIG`.

```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "cachePattern": "*.css,*.js,*.png"
    },
    "ios": {
      "cachePattern": "*.css,*.js,*.png"
    }
  }
}
```

This cache is implemented natively and is separate from the browser’s default storage.

## What to Cache

- Route JS chunks
- Critical CSS
- Shared fonts/icons
- Frequently used media

Prefer static, versioned resources over dynamic API responses or rapidly changing content.

## Good Defaults

- Use hashed filenames for immutable assets.
- Serve static assets through CDN in production.
- Keep cache-control headers strict for versioned assets.
- Use focused `cachePattern` values rather than broad wildcards.
- Validate cache behavior after every release.

## Common Pitfalls

- assuming native cache and WebView cache are the same thing
- caching too many assets and inflating package or storage cost
- using cache rules that do not match shipped filenames
- not testing offline and repeat-launch flows on real devices

## Related Docs

- [Universal App Cache Management](/content/Core%20Concepts/universal-app-cache-management)
- [Assets](/content/14-Best%20Practices/05-Assets.md)
