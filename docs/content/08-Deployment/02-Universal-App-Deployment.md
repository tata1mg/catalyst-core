---
title: Universal App Deployment
slug: universal-app-deployment
id: universal-app-deployment
---

# Universal App Deployment

Use this flow for Android and iOS release delivery. Universal app deployment is driven by `WEBVIEW_CONFIG` in `config/config.json`, so treat configuration accuracy as part of the release process.

## Android Release Flow

1. Set `WEBVIEW_CONFIG.android.buildType` to `release`.
2. Add a valid `keystoreConfig` with real signing values.
3. Run `catalyst build`.
4. Run `npm run buildApp:android`.
5. Upload the generated `.aab` from `deployment/` to Google Play.

Android release mode is controlled by `WEBVIEW_CONFIG.android.buildType`, not by a separate `:release` command.

Required Android release fields:

- `keyAlias`
- `storePassword`
- `keyPassword`
- `organizationInfo.companyName`
- `organizationInfo.city`
- `organizationInfo.state`
- `organizationInfo.countryCode`

## iOS Release Flow

1. Set `WEBVIEW_CONFIG.ios.buildType` to `Release`.
2. Set a real `appBundleId`.
3. If Google Sign-In is enabled, include `GoogleService-Info.plist`.
4. Run `catalyst build`.
5. Run `npm run buildApp:ios`.
6. Archive and export the IPA from Xcode or `xcodebuild`.
7. Upload the build to App Store Connect or TestFlight.

`WEBVIEW_CONFIG.ios.buildType` is case-sensitive. Use `Release`, not `release`.

## What to Validate Before Release

- API host and environment values
- `LOCAL_IP`, `port`, and access-control rules for the target environment
- app version and build number
- deep links and route handling
- offline and cache behavior
- runtime permissions (camera/files/notifications)
- store metadata, signing, and bundle identifiers

## Related Docs

- [Configuration API](/content/11-API%20Reference/02-Configuration.md)
- [Android Build Optimization](/content/Best%20Practices/android-build-optimization)
- [Security](/content/Best%20Practices/security)
- [Universal App Cache Management](/content/Core%20Concepts/universal-app-cache-management)
