---
title: iOS Simulator Setup
slug: ios-emulator-setup
id: ios-emulator-setup
---

# iOS Emulator Setup

This guide walks you through setting up an iOS simulator for development.

---

## Prerequisites

- macOS (required for iOS development)
- Xcode installed from the Mac App Store

---

## 1. Install Xcode

1. Open the Mac App Store
2. Search for "Xcode"
3. Click **Get** or **Install**
4. Wait for download and installation (this may take a while)

---

## 2. Install Command Line Tools

```bash
# Check if already installed
xcode-select -p

# If not installed, run:
xcode-select --install
```

---

## 3. Run Setup Script

```bash
npm run setupEmulator:ios
```

You'll see a list of available simulators. Enter the number for your desired device (e.g., iPhone 16 Pro).

---

## 4. Configuration

Update your `config/config.json`:

```json
{
  "WEBVIEW_CONFIG": {
    "port": "3005",
    "ios": {
      "buildType": "Debug",
      "appBundleId": "com.your.app",
      "simulatorName": "iPhone 16 Pro"
    }
  }
}
```

| Property | Description |
|----------|-------------|
| `port` | Development server port |
| `buildType` | `Debug` or `Release` |
| `appBundleId` | Your app's bundle identifier |
| `simulatorName` | Simulator name (spaces allowed) |

`buildType` is case-sensitive on iOS. Use `Debug` for simulator development and `Release` for store builds.

---

## 5. Verify Setup

After selecting a simulator, you should see:
- iOS simulator window
- Default iOS home screen
- Correct iOS version

---

## Useful Commands

```bash
# List all simulators
xcrun simctl list

# Open Simulator app
open -a Simulator

# Shutdown all simulators
xcrun simctl shutdown all

# Boot specific simulator
xcrun simctl boot "iPhone 16 Pro"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Simulator not found | Verify simulator name matches exactly |
| Xcode errors | Run `xcode-select --install` |
| Build failures | Clean build folder in Xcode (Cmd+Shift+K) |
