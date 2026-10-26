---
title: Android Emulator Setup
slug: android-emulator-setup
id: android-emulator-setup
---

# Android Emulator Setup

One command sets up everything an Android build needs: a JDK, the Android SDK packages and an emulator. Android Studio is not required. If you already have it, Catalyst reuses its SDK, its bundled JDK and your existing emulators.

---

## Prerequisites

- macOS or Linux
- About 10 GB of free disk space for the SDK and a system image
- Homebrew on macOS if you have no JDK 17 yet

---

## Run setup

```bash
npm run setupEmulator:android
```

The command works through these steps and only downloads what is missing:

1. Java. It looks for JDK 17 or newer in `JAVA_HOME`, then `/usr/libexec/java_home`, then the runtime bundled with Android Studio. On macOS with none found, it offers to run `brew install --cask zulu@17`. Your shell profile is never edited; the JDK is passed to Gradle and the SDK tools directly.
2. Android SDK. It uses `WEBVIEW_CONFIG.android.sdkPath`, then `ANDROID_HOME`, then `~/Library/Android/sdk` (macOS) or `~/Android/Sdk` (Linux). When packages are missing it downloads the Android command-line tools, checks them against their published SHA-256, and installs `platform-tools`, `emulator`, `platforms;android-36` and `build-tools;36.0.0`.
3. Licences. The first install shows the Android SDK licences for you to review and accept.
4. Emulator. An existing emulator is reused. With none, it installs the API 36 Google APIs system image for your CPU (arm64 on Apple silicon, x86_64 elsewhere) and creates `catalyst-api36`, a Pixel 7 profile.
5. Config. It asks before saving `port`, `buildType`, `sdkPath` and `emulatorName` to `config/config.json`.
6. It boots the emulator and starts the dev server on your LAN address.

Everything that downloads, accepts a licence or writes the config asks first. Press Enter to accept the default answer.

---

## Run setup in CI

Without a terminal, setup will not download or accept anything on its own. Pass the flags to allow it:

```bash
npx catalyst setupEmulator:android --yes --accept-licenses
```

- `--yes` allows the downloads, the emulator creation and the config write.
- `--accept-licenses` accepts the Android SDK licences.

Without them a missing piece fails with [ANDROID-008](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-008.md), and a missing JDK with [ANDROID-007](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-007.md). Release builds do not need an emulator, so CI usually only needs a JDK and the SDK.

---

## Configuration

Setup fills these in for you. You can also set them by hand:

```json
{
  "WEBVIEW_CONFIG": {
    "port": "3005",
    "android": {
      "buildType": "debug",
      "emulatorName": "catalyst-api36",
      "sdkPath": "~/Library/Android/sdk"
    }
  }
}
```

| Property | Description |
|----------|-------------|
| `port` | Development server port |
| `buildType` | `debug` or `release` |
| `emulatorName` | Emulator (AVD) name. If it does not exist, setup creates `catalyst-api36` instead |
| `sdkPath` | Android SDK location |

---

## Run the app

```bash
npm run buildApp:android
```

A debug build starts the dev server if it is not already running, boots the emulator if needed, then installs and opens the app.

To set the app icon, add `public/icon.png`: a square PNG of at least 1024x1024 pixels. Per-density icons in `public/android/appIcons` take precedence when present.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| [ANDROID-007](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-007.md) Java 17 or newer not found | Install JDK 17+ (`brew install --cask zulu@17` or `openjdk-17-jdk`) and set `JAVA_HOME`, or rerun setup in a terminal |
| [ANDROID-009](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-009.md) command-line tools did not install | Check your network or proxy, then retry |
| Emulator not found | `emulatorName` is case-sensitive; delete it from the config and rerun setup to pick or create one |
| Slow first boot | The first boot of a new emulator takes a few minutes |
