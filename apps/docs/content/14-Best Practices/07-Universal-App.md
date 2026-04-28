---
title: Universal App
slug: universal-app
id: universal-app-best-practices
---

# Universal App

Universal apps are easiest to maintain when the web app remains the source of truth and native behavior is added only where it materially improves the product. The biggest failures in Catalyst universal apps usually come from config drift, over-broad permissions, or weak offline and error handling.

## Configuration Discipline

- Keep `WEBVIEW_CONFIG` complete and explicit.
- Use a real `LOCAL_IP`, not `localhost`, for emulator and device builds.
- Keep web and native environment targets aligned so the app does not point to different APIs by platform.
- Treat `accessControl.allowedUrls` as a release checklist, not a casual config detail.

## Design For Fallbacks

- Every native capability should fail gracefully on both web and mobile.
- If a hook depends on `WebBridge`, provide a browser or no-op fallback where possible.
- Add `public/offline.html` so the native shell has a meaningful offline experience instead of a blank screen.
- Keep startup payload small so the WebView becomes interactive quickly.

## Route And Data Parity

- Validate deep links and route handling on web, Android, and iOS.
- Keep route-level data logic shared unless a platform genuinely needs different behavior.
- Ensure API domains used by the app are whitelisted so native request transport does not degrade unexpectedly.

## Permission And Release Hygiene

- request only the native permissions the feature actually needs
- review camera, files, and notifications before each release
- set `ios.appBundleId` and Android signing values early instead of right before release
- test both debug and release behavior because caching and signing flows differ

## Observability

- tag startup, bridge, and hook errors by platform
- measure startup time before and after enabling native caching features
- monitor offline recovery and cache hit behavior on real devices

## Related Docs

- [Universal App Deployment](/content/08-Deployment/02-Universal-App-Deployment.md)
- [Configuration API](/content/11-API%20Reference/02-Configuration.md)
