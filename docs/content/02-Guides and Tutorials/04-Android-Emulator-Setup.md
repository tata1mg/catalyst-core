---
title: Android Emulator Setup
slug: android-emulator-setup
id: android-emulator-setup
---

# Android Emulator Setup

This guide walks you through setting up an Android emulator for development.

---

## Prerequisites

- Android Studio installed
- Sufficient disk space (10GB+)

---

## 1. Install Android Studio

Download from the [Android Developer website](https://developer.android.com/studio) or use JetBrains Toolbox.

---

## 2. Configure Android SDK

1. Launch Android Studio
2. Click **More Actions** → **SDK Manager**
3. Navigate to **Settings** → **Languages & Frameworks** → **Android SDK**

### SDK Platforms Tab

Select the latest Android version (API level).

### SDK Tools Tab

Ensure these are installed:
- Android SDK Build-Tools
- Android Emulator
- Android SDK Platform-Tools

4. Note the **Android SDK Location** path — you'll need it for configuration
5. Click **Apply** → **OK**

---

## 3. Create a Virtual Device

1. Click **More Actions** → **Virtual Device Manager**
2. Click **Create device**
3. Select a hardware profile (e.g., Pixel 7)
4. Select a system image (e.g., API 34)
5. Name the device (must match `emulatorName` in config)
6. Click **Finish**

> **Note:** Avoid spaces in emulator names (use `testPhone` not `test Phone`).

---

## 4. Configuration

Update your `config/config.json`:

```json
{
  "WEBVIEW_CONFIG": {
    "port": "3005",
    "android": {
      "buildType": "debug",
      "emulatorName": "testPhone",
      "sdkPath": "/Users/yourname/Library/Android/sdk"
    }
  }
}
```

| Property | Description |
|----------|-------------|
| `port` | Development server port |
| `buildType` | `debug` or `release` |
| `emulatorName` | AVD name (from Virtual Device Manager) |
| `sdkPath` | Android SDK location. Optional when the SDK is in Android Studio's default location |

### Windows

The SDK is usually at `C:\\Users\\yourname\\AppData\\Local\\Android\\Sdk`. In `config.json`, double the backslashes or use forward slashes:

```json
{
  "WEBVIEW_CONFIG": {
    "android": {
      "sdkPath": "C:/Users/yourname/AppData/Local/Android/Sdk"
    }
  }
}
```

Catalyst uses `JAVA_HOME` if it is set, then any `java` on your `PATH`, then the JDK bundled with Android Studio. With none of those, install JDK 17 with `winget install Microsoft.OpenJDK.17` and open a new terminal.

`npm run setupEmulator:android` leaves the dev server running in the background, with no window of its own. To stop it, find its process with `netstat -ano | findstr :3005` and run `taskkill /PID <pid> /T /F`.

The emulator needs the Windows Hypervisor Platform. If it does not start, run `emulator -accel-check` from the SDK's `emulator` folder. It reports what is missing.

Gradle writes long paths under `node_modules`. If a build fails with a path that is too long, move the app closer to the root of the drive, for example `C:\\dev\\my-app`, or [enable long paths in Windows](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation#enable-long-paths-in-windows-10-version-1607-and-later).

---

## 5. Run the Emulator

```bash
npm run setupEmulator:android
```

This command:
- Validates your SDK setup
- Checks for running emulators
- Starts the configured emulator

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Emulator not found | Verify `emulatorName` matches exactly (case-sensitive) |
| SDK path error | Check `sdkPath` in config.json |
| Slow startup | First launch downloads components — wait a few minutes |
