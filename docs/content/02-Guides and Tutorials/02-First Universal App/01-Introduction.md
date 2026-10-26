---
title: First Universal App
slug: first-universal-app
id: first-universal-app
---

# First Universal App

This guide gives a clean first-flow for building a Catalyst universal app for Web, iOS, and Android.

## Prerequisites

- Node.js 20+
- For iOS: macOS with Xcode installed. You never need to open it.
- For Android: nothing else. Android Studio is optional; `setupEmulator:android` installs the JDK, SDK and emulator it needs.

## Step 1: Create App

```bash
npx create-catalyst-app@latest my-universal-app
cd my-universal-app
npm install
```

## Step 2: Configure Runtime

Set host, ports, and webview config in `config/config.json`.

[Configuration reference →](/content/Guides%20and%20Tutorials/First%20Universal%20App/universal-app-configuration)

## Step 3: Run on Web

```bash
npm run start
```

Open `http://localhost:3005`.

## Step 4: Prepare Emulators

```bash
npm run setupEmulator:android
npm run setupEmulator:ios
```

Each command installs what is missing after asking, then boots the emulator or simulator. See [Android Emulator Setup](/content/Guides%20and%20Tutorials/android-emulator-setup) and [iOS Simulator Setup](/content/Guides%20and%20Tutorials/ios-emulator-setup) for the details and the CI flags.

## Step 5: Run Universal App

```bash
npm run buildApp:android
npm run buildApp:ios
```

A debug build starts the dev server when it is not running, so this is the only command you need. Put a square PNG of at least 1024x1024 pixels at `public/icon.png` to set the app icon on both platforms.

- [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp)
- [Cache Management](/content/Guides%20and%20Tutorials/First%20Universal%20App/Cache-Management)

## Step 6: Native APIs

Use hooks from `catalyst-core/hooks` for platform-native features.

- [Hooks Overview](/content/API%20Reference/hooks)

## Next

- [Performance Profiling](/content/Core%20Concepts/performance-profiling)
- [Universal App Deployment](/content/Deployment/universal-app-deployment)
- [Best Practices for Universal Apps](/content/Best%20Practices/universal-app)
