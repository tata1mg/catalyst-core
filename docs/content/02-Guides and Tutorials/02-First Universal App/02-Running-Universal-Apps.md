---
title: Universal App Setup
slug: RunUniversalApp
id: RunUniversalApp
---

# Running Universal Apps

## Prerequisites

- Node.js and npm
- For iOS: macOS with Xcode installed (it never needs to be opened)
- For Android: nothing else; Android Studio is optional

---

## Run the app

```bash
npm run android
npm run ios
```

Each run:

1. Checks the toolchain and installs what is missing, after asking. See [Android Emulator Setup](/content/Guides%20and%20Tutorials/android-emulator-setup) and [iOS Simulator Setup](/content/Guides%20and%20Tutorials/ios-emulator-setup) for what that covers.
2. Picks where to run: the emulator or simulator, or a connected phone.
3. Starts the dev server with `catalyst start` when nothing answers on `NODE_SERVER_PORT`, and waits until it answers. The server keeps running after the build, with its output in a log file whose path is printed. A dev server you started yourself is reused.
4. Builds, installs and opens the app. Edit your code and the dev server reloads it.

On Android, each run also saves the app as an APK in `build-output/android/debug/`. See [Share a test build](#share-a-test-build).

Apps created before Catalyst 1.3.0 have `buildApp:android` and `buildApp:ios` scripts, which run the same commands. To get the short names, add these scripts to `package.json`:

```json title="package.json"
{
  "scripts": {
    "android": "catalyst buildApp:android",
    "ios": "catalyst buildApp:ios",
    "android:release": "catalyst buildApp:android --release",
    "ios:release": "catalyst buildApp:ios --release"
  }
}
```

---

## Emulator, simulator or phone

The app runs on the Android emulator or the iOS simulator by default. When a phone is connected and you run the command in a terminal, it asks which one to use. Your pick is remembered for this machine in `.catalyst/local.json`, which is kept out of git, and offered as the default next time.

To go straight to the phone, pass `--device`:

```bash
npm run android -- --device
npm run ios -- --device
```

- Android: turn on USB debugging in Developer options and accept the "Allow USB debugging" prompt on the phone. With several phones connected and no terminal, set `ANDROID_SERIAL` to the serial `adb devices` shows.
- iPhone: connect it, unlock it, accept "Trust This Computer" and turn on Developer Mode (Settings > Privacy & Security). With several iPhones connected and no terminal, set `WEBVIEW_CONFIG.ios.deviceUDID`.

Without a terminal and without `--device`, the app always runs on the emulator or simulator.

---

## How the app reaches the dev server

A debug build loads the dev server, never `WEBVIEW_CONFIG.url`. Catalyst works out the address for each target and puts it into the build only; `config/config.json` is not changed.

The one exception is `WEBVIEW_CONFIG.LOCAL_IP`. When it is a real host, such as your public site or a staging server on your VPN or office network, a debug build loads that host instead, with `port` and `useHttps`, and prints a line saying so. `localhost`, `127.0.0.1`, `0.0.0.0` and this computer's own addresses mean the dev server.

- Android emulator and USB phone: the app loads `http://localhost:<port>`. After the install and before the launch, Catalyst runs `adb reverse` for `NODE_SERVER_PORT`, the Vite HMR port (24678, or `devServer.hmr.port` from `buildConfig.js`) and every `localhost:<port>` in `config/config.json`, such as `API_URL`. A USB phone needs no Wi-Fi for this.
- iOS simulator: it shares the Mac's network, so the app loads `http://localhost:<port>`.
- iPhone: the app loads the dev server from the Mac's Bonjour name, `<Local Hostname>.local` (System Settings > General > Sharing), or the Mac's LAN IP when it has no Local Hostname. The iPhone and the Mac must be on the same Wi-Fi. Catalyst starts the dev server listening on the network for this. If a dev server is already running for this Mac only, the build stops with [NATIVE-006](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-006.md): stop that server and run the build again.

A debug build also adds the dev server's address to `accessControl.allowedUrls`, and points an `apiBaseUrl` on localhost or on your production `url` at the dev server.

### Run on a physical iPhone

An iPhone build is signed, even in debug. You need to do this once:

1. Sign in to Xcode with your Apple account: Xcode > Settings > Accounts. A free Apple account works.
2. Set `WEBVIEW_CONFIG.ios.developmentTeam` to your team ID. With a paid account it is under Membership details at developer.apple.com/account. With a free account, open any Xcode project, choose your Personal Team under Signing & Capabilities, and copy `DEVELOPMENT_TEAM` from Build Settings.

Catalyst then lets Xcode create the development certificate and profile and register the iPhone. With a free account, the first install also needs you to trust the developer on the iPhone (Settings > General > VPN & Device Management), and the app stops opening after seven days until you build it again.

### Upgrading from an older setup

Before Catalyst 1.3.0, the emulator setup wrote your LAN address into `config/config.json`. The first debug build on 1.3.0 puts `localhost` back where that address was saved: any value equal to one of this machine's current IP addresses (such as `LOCAL_IP`, `NODE_SERVER_HOSTNAME` or `PUBLIC_STATIC_ASSET_URL`), and any `http://` URL on one of those addresses. It prints each change. Other addresses, such as `0.0.0.0`, `127.0.0.1`, a container's IP or a staging server on your network, are left as they are, and so is `WEBVIEW_CONFIG.url`. It runs once per checkout and records that in `.catalyst/local.json`. It never runs for a release build or when `CI` is set, and apps with `WEBVIEW_CONFIG.allowPrivateHost` set to `true` are left alone. Review the change and commit it.

---

## Set the app icon

Replace the placeholder `public/icon.png` with a square PNG of at least 1024x1024 pixels. Android uses it as the launcher icon and iOS as a single 1024 AppIcon that Xcode scales. Keep it opaque; the App Store rejects icons with transparency. Per-density icons in `public/android/appIcons` and sized icons in `public/ios/appIcons` take precedence when present.

---

## Share a test build

Every `npm run android` saves the app it installed in `build-output/android/debug/`. `<App>` is your app name, and the next run overwrites the file:

- `<App>-debug.apk` when the app loads a real host from `WEBVIEW_CONFIG.LOCAL_IP`. It works on any Android phone that can reach that host.
- `<App>-debug-devserver.apk` when the app loads this computer's dev server. It only works while that dev server runs, so it is not one to share.

These are test builds: they can be debugged and allow plain HTTP, so never upload them to a store. `build-output/` has its own `.gitignore`, so the files stay out of git.

To share a test build with someone:

1. Set `WEBVIEW_CONFIG.LOCAL_IP` to your site, for example a public staging site or one on your VPN, with `port` and `useHttps` to match.
2. Run `npm run android` (`npm run buildApp:android` in apps created before 1.2.0).
3. Send them `build-output/android/debug/<App>-debug.apk`. They open it on the phone and allow the install.

Or build the release with `npm run android:release` and share the `<App>.apk` it writes next to the AAB. That APK loads your production `url`. It will not install over a copy from Google Play, so uninstall that first.

---

## Build for release

```bash
npm run android:release
npm run ios:release
```

In apps created before 1.2.0, run `npm run buildApp:android -- --release` and `npm run buildApp:ios -- --release`.

A release build loads `WEBVIEW_CONFIG.url` and refuses a local or private host. Run in a terminal, it asks once for an app id or website that is missing or still a placeholder, and saves your answer to `config/config.json`. [Universal App Deployment](/content/Deployment/universal-app-deployment) covers signing, version numbers and CI. `buildType: "release"` in `WEBVIEW_CONFIG.android` or `WEBVIEW_CONFIG.ios` still builds a release, with a deprecation warning; use the release scripts instead and set `buildType` back to `debug` or remove it.

---

## Useful commands

```bash
# Ports forwarded to an Android device
adb reverse --list

# List all simulators
xcrun simctl list

# Shut down all simulators
xcrun simctl shutdown all

# List connected iPhones
xcrun devicectl list devices
```

---

## Important notes

- Some corporate networks block the ports an iPhone needs to reach the dev server; use the simulator or a USB Android phone there
- Ensure `WEBVIEW_CONFIG.accessControl.allowedUrls` includes every required API or asset domain when access control is enabled
- The debug Android app id ends in `.debug`, so a debug and a store build can be installed side by side

For more answers, see the [FAQs](/content/faqs).
