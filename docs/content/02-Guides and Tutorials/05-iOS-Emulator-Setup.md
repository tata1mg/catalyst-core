---
title: iOS Simulator Setup
slug: ios-emulator-setup
id: ios-emulator-setup
---

# iOS Simulator Setup

Xcode has to be installed, but you never need to open it. `npm run ios` finishes Xcode's setup, installs an iOS simulator runtime if there is none, and creates a simulator.

---

## Prerequisites

- macOS
- Xcode from the Mac App Store. The Command Line Tools alone are not enough.

If you have more than one Xcode, select the one to use:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

---

## What gets installed

Every `npm run ios` works through these steps. Each install asks first.

1. Xcode. It checks that `xcode-select -p` points inside an Xcode app. If the Xcode licence or its first-launch components are pending, it prints the two commands that finish them (`sudo xcodebuild -license accept` and `sudo xcodebuild -runFirstLaunch`) and offers to run them. sudo asks for your password in your own terminal.
2. Runtime. With no iOS simulator runtime installed, it offers to run `xcodebuild -downloadPlatform iOS`. This download is several gigabytes.
3. Simulator. It uses an iPhone simulator you already have: `ios.simulatorName` when that simulator exists, else the one you picked last time, else one that is already booted, else the newest iPhone simulator on the runtime (a Pro model first). Only when there is no iPhone simulator at all does it offer to create one called "Catalyst iPhone" on the newest iPhone model the runtime supports.

A release build archives for any iOS device, so it only needs step 1.

---

## Without a terminal

In CI, or when an agent runs the command, nothing is asked. A step that needs an answer fails at once with [NATIVE-005](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-005.md), and the message names the flag that answers it:

```bash
npx catalyst buildApp:ios --yes --accept-licenses
```

- `--yes` allows the runtime download, the simulator creation and Xcode's first-launch install.
- `--accept-licenses` accepts the Xcode licence.

Without a terminal the sudo steps run as `sudo -n`, which only works where sudo needs no password, as on hosted CI runners. Elsewhere, run the two sudo commands yourself once. Commands also run without prompts when the `CI` environment variable is set.

---

## Set up a machine ahead of time

```bash
npx catalyst setupEmulator:ios
```

`setupEmulator:ios` runs the same three steps and nothing else. It does not write `config/config.json` and does not start the dev server. You only need it to prepare a Mac before the first build.

---

## Configuration

All of these are optional:

```json
{
  "WEBVIEW_CONFIG": {
    "ios": {
      "simulatorName": "iPhone 17 Pro",
      "developmentTeam": "ABCDE12345"
    }
  }
}
```

| Property | Description |
|----------|-------------|
| `simulatorName` | Simulator to run on (spaces allowed). When it does not exist, the build picks another iPhone simulator and warns |
| `developmentTeam` | Apple team ID. Needed to run on a physical iPhone and for release builds |
| `deviceUDID` | Which iPhone `--device` uses when several are connected and there is no terminal to ask |

---

## Run the app

```bash
npm run ios
```

This starts the dev server if it is not already running, boots the simulator, then installs and opens the app. [Running Universal Apps](/content/Guides%20and%20Tutorials/First%20Universal%20App/RunUniversalApp#run-on-a-physical-iphone) covers running on your own iPhone.

To set the app icon, replace `public/icon.png` with a square PNG of at least 1024x1024 pixels. It becomes a single 1024 AppIcon that Xcode scales to every size. The App Store rejects icons with transparency, so a debug build warns about an alpha channel and a release build fails on it. The sized icons in `public/ios/appIcons` take precedence when present.

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
| [IOS-004](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-004.md) No iOS simulator runtime | Run again in a terminal or with `--yes`, or run `xcodebuild -downloadPlatform iOS` |
| [IOS-014](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-014.md) No connected iPhone found | Unlock the iPhone, trust this Mac and turn on Developer Mode, or drop `--device` |
| [IOS-015](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-015.md) No address the iPhone can reach this Mac on | Join the Mac and the iPhone to the same Wi-Fi and check the Local Hostname in System Settings > General > Sharing |
