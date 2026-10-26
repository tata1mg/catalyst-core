---
title: First Universal App
slug: first-universal-app
id: first-universal-app
---

# First Universal App

This guide gives a clean first-flow for building a Catalyst universal app for Web, iOS, and Android.

## Prerequisites

- Node.js 20+
- Android Studio + Android SDK
- Xcode (for iOS on macOS)

## Step 1: Create App

```bash
npx create-catalyst-app@latest my-universal-app
cd my-universal-app
npm install
```

## Step 2: Configure Runtime

Set host, ports, and webview config in `config/config.json`.

[Configuration reference →](/content/guides-and-tutorials/first-universal-app/universal-app-configuration)

## Step 3: Run on Web

```bash
npm run start
```

Open `http://localhost:3005`.

## Step 4: Prepare Emulators

- [Android Emulator Setup](/content/guides-and-tutorials/native-development-setup/android-emulator-setup)
- [iOS Simulator Setup](/content/guides-and-tutorials/native-development-setup/ios-emulator-setup)

## Step 5: Run Universal App

- [Running Universal Apps](/content/guides-and-tutorials/first-universal-app/RunUniversalApp)
- [Cache Management](/content/guides-and-tutorials/first-universal-app/configuring-cache-behavior)

## Step 6: Native APIs

Use hooks from `catalyst-core/hooks` for platform-native features.

- [Hooks Overview](/content/api-reference/hooks)

## Next

- [Performance Profiling](/content/core-concepts/performance-profiling)
- [Universal App Deployment](/content/deployment/universal-app-deployment)
- [Best Practices for Universal Apps](/content/best-practices/universal-app)
