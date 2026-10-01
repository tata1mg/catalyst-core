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

1. Deploy the production web application over HTTPS.
2. Finalize `WEBVIEW_CONFIG`, the bundle identifier, version, build number, capabilities, and app assets.
3. Run `npm run buildApp:ios` from the consuming Catalyst app.
4. Open the generated `iosnativeWebView.xcodeproj` and configure Release signing.
5. Archive the `iosnativeWebView` scheme with a generic iOS device destination.
6. Validate and upload the archive through Xcode.
7. Complete TestFlight testing and the App Store Connect release.

`npm run buildApp:ios` prepares the package-owned Xcode project and performs a Debug native build. It does not create the App Store archive. The production artifact is created by the scheme's Release Archive action in Xcode. This flow is the same for Catalyst `0.2.x` and `0.3.x`.

See [Building and Releasing a Catalyst iOS App](/content/Deployment/ios-production-release) for the complete release procedure and checklist.

## What to Validate Before Release

- API host and environment values
- `LOCAL_IP`, `port`, and access-control rules for the target environment
- app version and build number
- deep links and route handling
- offline and cache behavior
- runtime permissions (camera/files/notifications)
- store metadata, signing, and bundle identifiers

## Related Docs

- [Configuration API](/content/11-API%20Reference/02-Configuration.mdx)
- [Android Build Optimization](/content/Best%20Practices/android-build-optimization)
- [Security](/content/Best%20Practices/security)
- [Universal App Cache Management](/content/Core%20Concepts/universal-app-cache-management)
