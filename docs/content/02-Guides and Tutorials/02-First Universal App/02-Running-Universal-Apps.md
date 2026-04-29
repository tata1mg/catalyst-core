---
title: Universal App Setup
slug: RunUniversalApp
id: RunUniversalApp
---

# Universal App Setup and Running Guide

## Prerequisites

- Android Studio installed (for Android development)
- Xcode installed (for iOS development)
- Node.js and npm installed
- Android SDK configured (for Android)
- iOS Simulator set up (for iOS)

---

## Running the App

### 1. Create Catalyst App

```bash
npx create-catalyst-app@latest
```

### 2. Get Your Local IP Address

```bash
# For macOS
ifconfig | grep "inet " | grep -v 127.0.0.1

# For Linux
ip addr show | grep "inet "
```

### 3. Update Configuration

Set a reachable local IP in `WEBVIEW_CONFIG.LOCAL_IP`. Use your LAN IP, not `localhost`.

```json
{
  "WEBVIEW_CONFIG": {
    "LOCAL_IP": "192.168.1.100",
    "port": "3005"
  }
}
```

### 4. Set Up Emulator

- [Android Emulator Setup Guide](/content/Guides%20and%20Tutorials/android-emulator-setup)
- [iOS Simulator Setup Guide](/content/Guides%20and%20Tutorials/ios-emulator-setup)

### 5. Build and Run

```bash
# Build web assets
npm run build
```

In a new terminal:

```bash
# For Android debug
npm run buildApp:android

# For iOS
npm run buildApp:ios
```

---

## Useful Commands

### iOS Simulator Commands

```bash
# List all simulators
xcrun simctl list

# List available runtimes
xcrun simctl list runtimes --json

# Open Simulator app
open -a Simulator

# Shutdown all simulators
xcrun simctl shutdown all

# Boot specific simulator
xcrun simctl boot DEVICE_UUID

# Install app on booted simulator
xcrun simctl install booted /path/to/your/app.app

# Launch app on simulator
xcrun simctl launch booted your.app.bundle.id
```

---

## Important Notes

- The local IP address might change when switching networks
- Some corporate networks might block required ports
- iOS build types are case-sensitive: use `Debug` or `Release`
- Keep your SDK tools and development environment updated
- Ensure `WEBVIEW_CONFIG.accessControl.allowedUrls` includes every required API or asset domain when access control is enabled

For detailed troubleshooting, see the [Universal App FAQ](./01-Introduction.md#frequently-asked-questions-faq).
