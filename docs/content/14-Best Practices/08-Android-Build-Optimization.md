---
title: Android Build Optimization
slug: android-build-optimization
id: android-build-optimization
---

# Android Build Optimization

Android build optimization preloads selected static assets from device storage to reduce first-load latency inside the WebView. It is a release-oriented optimisation, not a default switch to turn on everywhere.

## Configuration

```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "buildOptimisation": true,
      "cachePattern": "*.png,*.jpg,*.css,*.js",
      "buildType": "release"
    }
  }
}
```

## When To Use It

Enable it when:

- startup time is materially affected by repeated loading of JS, CSS, or image assets
- the app has a stable release asset set
- you can measure startup before and after the change

Avoid treating it as a blanket performance feature for development or for fast-changing assets.

## Asset Selection

`cachePattern` should target high-value static resources only, for example:

- `*.js`
- `*.css`
- `*.png`
- `*.jpg`

Be conservative. Over-caching low-value assets increases package size and can make debugging harder.

## Release Checklist

- set `WEBVIEW_CONFIG.android.buildType` to `release`
- provide a valid `keystoreConfig` for signing
- run `catalyst build` before the Android release build
- verify AAB size impact after changing cache patterns
- test cold start performance on a real device, not just an emulator

## Measurement Guidance

- compare cold start time before and after enabling `buildOptimisation`
- compare final AAB size after expanding `cachePattern`
- watch for regressions in stale asset behavior after releases

## Common Mistakes

- enabling it in debug flows and expecting HMR-friendly behavior
- caching too many assets without measuring package growth
- treating missing keystore config as a late-stage release task
- assuming release build success without validating the signed AAB on device

## Recommendations

- Enable in release builds.
- Cache only high-impact static assets.
- Validate AAB size impact.
- Track startup metrics before and after enabling it.
