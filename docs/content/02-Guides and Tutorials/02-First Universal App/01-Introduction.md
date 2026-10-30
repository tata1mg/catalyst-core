---
title: First Universal App
slug: first-universal-app
id: first-universal-app
---

# First Universal App

This guide gives a clean first-flow for building a Catalyst universal app for Web, iOS, and Android.

## Prerequisites

- Node.js 22 or newer
- For iOS: macOS with Xcode installed. You never need to open it.
- For Android: nothing else. Android Studio is optional; the first build installs the JDK, SDK and emulator it needs.

## Step 1: Create App

```bash
npx create-catalyst-app@latest my-universal-app
cd my-universal-app
```

Every new app is ready for Android and iOS. It gets:

- `WEBVIEW_CONFIG.appId` set to `com.example.<project name>` and `appName` from the project name, for example `com.example.myuniversalapp` and "My Universal App"
- `public/icon.png`, a placeholder Catalyst icon at 1024x1024 with no transparency
- the scripts `android`, `ios`, `android:release` and `ios:release` in `package.json`
- `credentials/`, `.catalyst/` and `build-output/` in `.gitignore`, for signing keys, per-machine CLI state and store builds

## Step 2: Set the App Id

`appId` is the Android package name and the iOS bundle id. Replace `com.example.myuniversalapp` with your own reverse-DNS id, for example `com.yourcompany.myapp`. Debug builds work with the placeholder, but a release build refuses any `com.example.` id, and the stores do not let you change the id after the first upload.

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "appId": "com.yourcompany.myapp",
    "appName": "My App"
  }
}
```

[Configuration reference →](/content/Guides%20and%20Tutorials/First%20Universal%20App/universal-app-configuration)

## Step 3: Run on Web

```bash
npm run start
```

Open `http://localhost:3005`.

## Step 4: Run on Android and iOS

```bash
npm run android
npm run ios
```

The first run installs what is missing after asking, starts the dev server if it is not running, and opens the app on an emulator or simulator. With a phone connected, it asks where to run. See [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp) for phones and the dev server, and [Android Emulator Setup](/content/Guides%20and%20Tutorials/android-emulator-setup) and [iOS Simulator Setup](/content/Guides%20and%20Tutorials/ios-emulator-setup) for what gets installed.

Replace `public/icon.png` with your own square PNG of at least 1024x1024 pixels to set the app icon on both platforms.

## Step 5: Build for Release

Deploy the web app over HTTPS and set `WEBVIEW_CONFIG.url` to its address, for example `https://shop.acme.com`. Then:

```bash
npm run android:release
npm run ios:release
```

The first Android release in a terminal offers to create your upload key in `credentials/android/`; back it up with `npx catalyst credentials:export android`. The signed AAB lands in `build-output/android/<version>-<build>/` and the IPA in `build-output/ios/<version>-<build>/`. iOS signing needs files in `credentials/ios/`; see [Building and Releasing a Catalyst iOS App](/content/Deployment/ios-production-release).

Uploading to Google Play and App Store Connect is manual. [Releasing a Full App](/content/Deployment/releasing-a-full-app) walks through the first release end to end, and [Universal App Deployment](/content/Deployment/universal-app-deployment#native-ci) has a GitHub Actions workflow for CI.

## Step 6: Native APIs

Use hooks from `catalyst-core/hooks` for platform-native features.

- [Hooks Overview](/content/API%20Reference/hooks)

## Next

- [Performance Profiling](/content/Core%20Concepts/performance-profiling)
- [Universal App Deployment](/content/Deployment/universal-app-deployment)
- [Best Practices for Universal Apps](/content/Best%20Practices/universal-app)
