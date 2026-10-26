---
title: Universal App Setup
slug: RunUniversalApp
id: RunUniversalApp
---

# Universal App Setup and Running Guide

## Prerequisites

- Node.js and npm
- For iOS: macOS with Xcode installed (it never needs to be opened)
- For Android: nothing else; Android Studio is optional

---

## Running the App

### 1. Create Catalyst App

```bash
npx create-catalyst-app@latest
```

Pick Android, iOS or both under "Native platforms" and give the app id. This fills in the native part of `config/config.json` and adds a placeholder icon and a CI workflow. See [First Universal App](/content/Guides%20and%20Tutorials/First%20Universal%20App/first-universal-app) for what is generated.

### 2. Set Up the Emulator or Simulator

```bash
npm run setupEmulator:android
npm run setupEmulator:ios
```

Setup installs what is missing after asking: the JDK, Android SDK packages and an emulator on Android; the iOS simulator runtime and a simulator on iOS. It also writes your LAN address into `config/config.json`, so the app on the device can reach the dev server. Details are in the [Android Emulator Setup Guide](/content/Guides%20and%20Tutorials/android-emulator-setup) and the [iOS Simulator Setup Guide](/content/Guides%20and%20Tutorials/ios-emulator-setup).

### 3. Build and Run

```bash
# Android debug
npm run buildApp:android

# iOS
npm run buildApp:ios
```

A debug build checks whether the dev server is listening on `WEBVIEW_CONFIG.port`. If not, it points the config at your LAN address and starts `npm start` in the background, with its output in a log file under your temp directory. If the server is already running, the build leaves it alone.

### 4. Set the App Icon

Replace the placeholder `public/icon.png` (or add one, for an app created without native platforms): a square PNG of at least 1024x1024 pixels. Android uses it as the launcher icon and iOS as a single 1024 AppIcon that Xcode scales. Keep it opaque; the App Store rejects icons with transparency. Per-density icons in `public/android/appIcons` and sized icons in `public/ios/appIcons` take precedence when present.

### 5. Build for Release

```bash
npm run buildApp:android -- --release --build-number 1
npm run buildApp:ios -- --release --build-number 1
```

A release build uses `WEBVIEW_CONFIG.release` for the production host and fails on a local or private one. [Universal App Deployment](/content/Deployment/universal-app-deployment) covers signing, version numbers and the CI workflow.

---

## Useful Commands

### iOS Simulator Commands

```bash
# List all simulators
xcrun simctl list

# List available runtimes
xcrun simctl list runtimes --json

# Open Simulator app
open -a Simulator

# Shutdown all simulators
xcrun simctl shutdown all

# Boot specific simulator
xcrun simctl boot DEVICE_UUID

# Install app on booted simulator
xcrun simctl install booted /path/to/your/app.app

# Launch app on simulator
xcrun simctl launch booted your.app.bundle.id
```

---

## Important Notes

- The local IP address might change when switching networks; rerun `setupEmulator` to update it
- Some corporate networks might block required ports
- `ios.buildType` set to `release` (any case) makes `buildApp:ios` build the store IPA instead of running the app; leave it at `debug` for development
- Keep your SDK tools and development environment updated
- Ensure `WEBVIEW_CONFIG.accessControl.allowedUrls` includes every required API or asset domain when access control is enabled

For detailed troubleshooting, see the [Universal App FAQ](./01-Introduction.md#frequently-asked-questions-faq).
