---
title: Building and Releasing a Catalyst iOS App
slug: ios-production-release
id: ios-production-release
---

# Building and Releasing a Catalyst iOS App

This guide explains how to produce an iOS app for TestFlight and the App Store from a Catalyst universal app.

> **Important:** `npm run buildApp:ios` is a native-project generation and Debug-run command. It does not create the final production archive. The App Store artifact is created by archiving the generated Xcode project using its **Release** configuration.

## Before you begin

- Enroll the releasing Apple account in the Apple Developer Program.
- Deploy the production web application first. Catalyst's iOS app loads the configured remote URL in a WebView.
- Use an HTTPS production URL. Release configuration does not permit arbitrary HTTP loads.
- Finalize application identity and assets:
    - unique bundle identifier
    - app name, version, and incremented build number
    - app icons and splash image
    - required permissions, capabilities, and privacy declarations
    - production URL, initial route, and access-control configuration

## 1. Generate the native iOS project

From the root of the consuming Catalyst app, run:

```bash
npm run buildApp:ios
```

This command reads the app's `config/config.json` and selected `public/` assets, generates native configuration and plugin code, and prepares the iOS project.

It also performs a **Debug** native build and may install or launch it on a connected device or simulator. This is expected; it is not the production binary.

### Generated project location

For a normal installed dependency, open:

```text
node_modules/catalyst-core/dist/native/iosnativeWebView/iosnativeWebView.xcodeproj
```

## 2. Open and prepare the project in Xcode

1. Open `iosnativeWebView.xcodeproj` in Xcode.
2. Select the **iosnativeWebView** target and scheme.
3. Confirm the Archive action uses **Release**. The supplied scheme already does this; a separate production scheme is not required.
4. In **Signing & Capabilities**, set the correct Apple Developer team and review the following:
    - Bundle Identifier
    - Version and Build
    - capabilities and entitlement values
    - app icon and launch assets

### Signing configuration

For the normal App Store route, prefer **Automatically manage signing** with the correct team selected. Xcode can then select the appropriate Apple Distribution signing assets.

If the organization uses manual signing, select a valid Apple Distribution certificate and App Store provisioning profile for the Release target.

## 3. Create the production archive

1. In Xcode's destination selector, choose **Any iOS Device (arm64)** or another generic iOS device destination. Do not select a simulator.
2. Choose **Product → Archive**.
3. After the archive completes, Xcode opens the Organizer.
4. Select the archive and choose **Validate App**.
5. Choose **Distribute App**.
6. Choose **TestFlight & App Store**.
7. Complete the signing/export prompts and upload the build.

## 4. Complete the release in App Store Connect

1. Wait for Apple to process the uploaded build.
2. Distribute it through TestFlight and complete release testing.
3. In App Store Connect, complete required product details, including metadata, screenshots, privacy disclosures, pricing, and availability.
4. Select the processed build for the release version.
5. Submit the app for App Review.

Apple's current release workflow is documented in [Distributing your app for beta testing and releases](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

## Regeneration and persistence warning

The Xcode project is generated package-owned state. Run the final `npm run buildApp:ios` before making release-only changes in Xcode.

A later Catalyst generation, package upgrade, or dependency installation can replace or regenerate:

- native config constants and shared Xcode configuration
- app plist and entitlement content
- generated plugin code and resources
- selected project-file entries and assets

Therefore, do not treat manual edits inside the generated project as durable application configuration.

## Release checklist

- [ ] Production web application is deployed and reachable over HTTPS.
- [ ] `config/config.json` uses the production host and initial route.
- [ ] Bundle ID, version, and build number are final and unique.
- [ ] Icons, splash assets, permissions, and capabilities are reviewed.
- [ ] Final `npm run buildApp:ios` has completed.
- [ ] Release signing uses the correct team and Apple Distribution assets.
- [ ] Push notification entitlement is reviewed, if applicable.
- [ ] Archive is built from a generic device destination, not a simulator.
- [ ] Archive validates successfully and uploads to App Store Connect.
- [ ] The TestFlight build is tested before App Review submission.
