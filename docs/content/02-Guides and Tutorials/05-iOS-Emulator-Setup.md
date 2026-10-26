---
title: iOS Simulator Setup
slug: ios-emulator-setup
id: ios-emulator-setup
---

# iOS Simulator Setup

Xcode has to be installed, but you never need to open it. One command finishes Xcode's setup, installs an iOS simulator runtime if there is none, and creates a simulator.

---

## Prerequisites

- macOS
- Xcode from the Mac App Store. The Command Line Tools alone are not enough.

If you have more than one Xcode, select the one to use:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

---

## Run setup

```bash
npm run setupEmulator:ios
```

The command works through these steps:

1. Xcode. It checks that `xcode-select -p` points inside an Xcode app. If the Xcode licence or its first-launch components are pending, it prints the two commands that finish them (`sudo xcodebuild -license accept` and `sudo xcodebuild -runFirstLaunch`) and offers to run them. sudo asks for your password in your own terminal.
2. Runtime. With no iOS simulator runtime installed, it offers to run `xcodebuild -downloadPlatform iOS`. This is a download of several gigabytes.
3. Simulator. With no `simulatorName` in the config, it lists your simulators. The default choice creates "Catalyst iPhone" on the newest iPhone model the runtime supports.
4. It saves `simulatorName` to `config/config.json`, boots the simulator and starts the dev server.

---

## Run setup in CI

Without a terminal, setup never runs sudo and never downloads on its own:

```bash
npx catalyst setupEmulator:ios --yes
```

`--yes` allows the runtime download and creates "Catalyst iPhone". Pending Xcode licence or first-launch steps still fail with [IOS-003](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-003.md); run the two sudo commands in the CI image setup instead.

---

## Configuration

```json
{
  "WEBVIEW_CONFIG": {
    "port": "3005",
    "ios": {
      "buildType": "Debug",
      "appBundleId": "com.your.app",
      "simulatorName": "Catalyst iPhone"
    }
  }
}
```

| Property | Description |
|----------|-------------|
| `port` | Development server port |
| `buildType` | `debug` or `release` |
| `appBundleId` | Your app's bundle identifier |
| `simulatorName` | Simulator name (spaces allowed) |

Use `debug` for simulator and device development. `release` (in any case) makes `buildApp:ios` build the signed store IPA instead; see [iOS Production Release](/content/08-Deployment/03-iOS-Production-Release.md).

---

## Run the app

```bash
npm run buildApp:ios
```

A debug build starts the dev server if it is not already running, boots the simulator, then installs and opens the app.

To set the app icon, add `public/icon.png`: a square PNG of at least 1024x1024 pixels. It becomes a single 1024 AppIcon that Xcode scales to every size. The App Store rejects icons with transparency, so a debug build warns about an alpha channel and a release build fails on it. The sized icons in `public/ios/appIcons` take precedence when present.

---

## Useful commands

```bash
# List all simulators
xcrun simctl list

# Shut down all simulators
xcrun simctl shutdown all

# Boot a simulator by name
xcrun simctl boot "Catalyst iPhone"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| [IOS-002](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-002.md) Full Xcode is not installed or selected | Install Xcode and run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` |
| [IOS-003](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-003.md) Xcode setup is not finished | Run `sudo xcodebuild -license accept` and `sudo xcodebuild -runFirstLaunch` |
| [IOS-004](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-004.md) No iOS simulator runtime | Rerun setup in a terminal or with `--yes`, or run `xcodebuild -downloadPlatform iOS` |
| Simulator not found | `simulatorName` must match exactly; delete it and rerun setup to pick or create one |
