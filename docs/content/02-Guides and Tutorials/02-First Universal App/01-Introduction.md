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
```

Answer "Native platforms" with Android, iOS or both, and accept or edit the suggested app id. The app id is the Android package name and the iOS bundle id, so use your own reverse-DNS domain, for example `com.yourcompany.myapp`. Google Play rejects ids that start with `com.example`. To skip the questions, pass them as flags:

```bash
npx create-catalyst-app@latest my-universal-app --yes --native both --app-id com.yourcompany.myapp
```

`--native` takes `none`, `android`, `ios` or `both`. Without it, `--yes` creates a web-only app.

For the chosen platforms the app gets:

- `android.packageName` and `ios.appBundleId` set to the app id, `appName` from the project name, and a `version` block from `package.json`
- a `WEBVIEW_CONFIG.release` block whose `LOCAL_IP` is the placeholder `your-production-host.localhost`. Release builds refuse it until you put your production host there
- `public/icon.png`, a placeholder Catalyst icon at 1024x1024 with no transparency
- `credentials/` in `.gitignore`, where the Android upload key will live
- `.github/workflows/catalyst-native.yml`, which builds release binaries in GitHub Actions

## Step 2: Configure Runtime

Set host, ports, and webview config in `config/config.json`. For development, leave `LOCAL_IP` as it is; the emulator setup writes your LAN address there.

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

A debug build starts the dev server when it is not running, so this is the only command you need. Replace `public/icon.png` with your own square PNG of at least 1024x1024 pixels to set the app icon on both platforms.

- [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp)
- [Cache Management](/content/Guides%20and%20Tutorials/First%20Universal%20App/Cache-Management)

## Step 6: Build for Release

Deploy the web app over HTTPS and set `WEBVIEW_CONFIG.release.LOCAL_IP` to its host. Then:

```bash
npm run buildApp:android -- --release --build-number 1
npm run buildApp:ios -- --release --build-number 1
```

The first Android release in a terminal offers to create your upload key in `credentials/android/`; back that folder up. The signed AAB lands in `build-output/`, and the IPA in `build/native/ios/<version>-<build>/`. iOS signing needs `ios.developmentTeam` and an App Store Connect API key, or one of the other options in [Building and Releasing a Catalyst iOS App](/content/Deployment/ios-production-release).

## Step 7: Build in CI

The generated `.github/workflows/catalyst-native.yml` runs the same release builds on GitHub Actions when you push a `v*` tag or start it by hand. Add the secrets listed at the top of the file first. It uploads the AAB and IPA as workflow artifacts and does not publish anything. See [Native CI](/content/Deployment/universal-app-deployment#native-ci).

## Step 8: Native APIs

Use hooks from `catalyst-core/hooks` for platform-native features.

- [Hooks Overview](/content/API%20Reference/hooks)

## Next

- [Performance Profiling](/content/Core%20Concepts/performance-profiling)
- [Universal App Deployment](/content/Deployment/universal-app-deployment)
- [Best Practices for Universal Apps](/content/Best%20Practices/universal-app)
