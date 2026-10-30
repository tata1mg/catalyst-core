---
title: Android Emulator Setup
slug: android-emulator-setup
id: android-emulator-setup
---

# Android Emulator Setup

`npm run android` sets up what an Android build needs by itself: a JDK, the Android SDK packages and an emulator. Android Studio is not required. If you already have it, Catalyst reuses its SDK, its bundled JDK and your existing emulators.

---

## Prerequisites

- macOS or Linux
- About 10 GB of free disk space for the SDK and a system image
- Homebrew on macOS if you have no JDK yet. On Linux, install a JDK 17 or 21 package (for example `openjdk-17-jdk`) yourself

---

## What gets installed

Every `npm run android` and `npm run android:release` checks the toolchain and installs only what is missing. Each install asks first; press Enter to accept the default answer.

1. Java. Catalyst looks for JDK 17 to 23 in `JAVA_HOME`, then `/usr/libexec/java_home`, then the runtime bundled with Android Studio, and prefers 21, then 17. A JDK 24 or newer is skipped, because Gradle 8.13 cannot run on it. On macOS with none found, it offers to run `brew install --cask zulu@17`. Your shell profile is never edited; the JDK is passed to Gradle and the SDK tools directly.
2. Android SDK. It uses `WEBVIEW_CONFIG.android.sdkPath`, then `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then `~/Library/Android/sdk` (macOS) or `~/Android/Sdk` (Linux). It never asks for a path and never writes one to `config/config.json`. When packages are missing it downloads the Android command-line tools, checks them against their published SHA-256, and installs `platform-tools`, `platforms;android-36` and `build-tools;36.0.0`, plus `emulator` when the app runs on one.
3. Licences. The first install shows the Android SDK licences for you to review and accept.
4. Emulator. An existing emulator is reused: `android.emulatorName` when it is set, else the one you used last, else the first one found. With none, Catalyst installs the API 36 Google APIs system image for your CPU (arm64 on Apple silicon, x86_64 elsewhere, about 1.5 GB) and creates `catalyst-api36` with a Pixel 7 profile.

A release build or a run on a connected phone skips the emulator and its system image.

---

## Without a terminal

In CI, or when an agent runs the command, nothing is asked. A step that needs an answer fails at once with [NATIVE-005](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-005.md), and the message names the flag that answers it:

```bash
npx catalyst buildApp:android --yes --accept-licenses
```

- `--yes` allows the downloads and installs: the JDK through Homebrew, the SDK packages and the emulator.
- `--accept-licenses` accepts the Android SDK licences.

Commands also run without prompts when the `CI` environment variable is set. A declined install fails with [ANDROID-008](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-008.md), and a missing JDK with [ANDROID-007](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-007.md).

---

## Set up a machine ahead of time

```bash
npx catalyst setupEmulator:android
```

`setupEmulator:android` runs the same checks and installs, then starts the emulator. It changes nothing in the app: it does not write `config/config.json` and does not start the dev server. It takes `--yes` and `--accept-licenses` as well. You only need it to prepare a machine before the first build.

---

## Configuration

All of these are optional:

```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "emulatorName": "Pixel_8_API_36",
      "sdkPath": "~/Android/Sdk"
    }
  }
}
```

| Property | Description |
|----------|-------------|
| `emulatorName` | Emulator (AVD) to use. If it does not exist, Catalyst warns and uses another one, or creates `catalyst-api36` |
| `sdkPath` | Android SDK location, when it is not in one of the places above |

---

## Run the app

```bash
npm run android
```

This starts the dev server if it is not already running, boots the emulator if needed, then installs and opens the app. [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp) covers connected phones and how the app reaches the dev server.

To set the app icon, replace `public/icon.png` with a square PNG of at least 1024x1024 pixels. Per-density icons in `public/android/appIcons` take precedence when present.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| [ANDROID-007](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-007.md) No JDK 17 to 23 found | Install JDK 17 or 21 (`brew install --cask zulu@17` or `openjdk-17-jdk`) and set `JAVA_HOME`, or run again in a terminal or with `--yes` |
| [ANDROID-008](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-008.md) Android SDK setup was declined | Run again and answer yes, or pass `--yes` and `--accept-licenses` |
| [ANDROID-009](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-009.md) Command-line tools did not install | Check your network or proxy, then retry |
| [ANDROID-011](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-011.md) No Android phone connected | Turn on USB debugging, accept the prompt on the phone and check `adb devices`, or drop `--device` |
| Slow first boot | The first boot of a new emulator takes a few minutes |
