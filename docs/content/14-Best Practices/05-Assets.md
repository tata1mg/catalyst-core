---
title: Assets
slug: Assets
id: Assets
---

# Assets

Asset handling in Catalyst works best when you separate three concerns clearly: public files, bundled app assets, and native-only assets. Mixing them leads to broken URLs, unnecessary bundle weight, and release-time surprises.

## Use The Right Asset Location

### `public/`

Use `public/` for files that must be served as-is:

- `favicon.ico`
- `manifest.json`
- `robots.txt`
- static share images
- `offline.html` for native offline fallback

```
public/
├── favicon.ico
├── manifest.json
├── robots.txt
└── images/
    └── logo.png
```

Access them at the root path:

```jsx
<img src="/images/logo.png" alt="Logo" />
<link rel="icon" href="/favicon.ico" />
```

### Imported assets in app code

Import assets from source when they are part of the application UI. This lets webpack fingerprint and bundle them correctly.

```jsx
import logo from "@static/images/logo.png";

function Header() {
  return <img src={logo} alt="Logo" />;
}
```

### Native assets

Some universal app assets are discovered from the filesystem during native builds. They are not configured through config keys:

- app icons in `public/android/appIcons/` and `public/ios/appIcons/`
- splash images in `public/android/splashscreen.*` and `public/ios/splashscreen.*`
- notification icons in `public/notification-icon.*` and `public/notification-large.*`
- offline fallback page at `public/offline.html`

Do not add custom config paths for these assets. Catalyst native build scripts discover them by location and naming pattern.

## Configure Asset Delivery Correctly

For production builds, make sure the emitted asset host is correct:

```json
{
  "PUBLIC_STATIC_ASSET_URL": "https://cdn.example.com",
  "PUBLIC_STATIC_ASSET_PATH": "/assets/"
}
```

If the asset URL is wrong, SSR may work while styles, chunks, or images fail after hydration.

## Caching Guidance

- fingerprinted bundled assets are good candidates for aggressive CDN caching
- cache large static resources intentionally rather than blanket-caching everything
- for universal apps, use `cachePattern` for high-value static assets only
- verify that your cache patterns match filenames, not assumptions about full URLs

## Practical Recommendations

- keep `public/` for truly public files, not for every image in the app
- import UI assets from source code when you want bundling and hashing
- optimize image size before commit rather than relying on runtime delivery alone
- test `offline.html` on an actual offline device flow, not just in browser devtools
- treat native icons and splash assets as release artifacts and validate them in the packaged app

## Best Practices

1. **Use `public/` selectively** for files that must keep a stable URL.
2. **Import app-owned assets in code** when you want bundling and cache-safe filenames.
3. **Use a CDN in production** by setting `PUBLIC_STATIC_ASSET_URL` correctly.
4. **Keep native asset naming exact** because build-time discovery depends on it.
