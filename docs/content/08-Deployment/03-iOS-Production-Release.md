---
title: Building and Releasing a Catalyst iOS App
slug: ios-production-release
id: ios-production-release
---

# Building and Releasing a Catalyst iOS App

From Catalyst 1.1.1, `buildApp:ios --release` produces the signed IPA for TestFlight and the App Store. Xcode has to be installed, but you never open it: the CLI archives the app, signs it and exports the IPA, on your Mac and in CI.

```bash
npm run buildApp:ios -- --release --build-number 12
```

The IPA and its zipped debug symbols land in `<BUILD_OUTPUT_PATH>/native/ios/<version>-<build>/` inside your app, for example `build/native/ios/2.5.0-12/MyApp.ipa` and `MyApp-dSYMs.zip`. Upload the IPA with Apple's Transporter app or your usual upload tool. Catalyst does not upload it for you yet.

## Before you begin

- Enroll the releasing Apple account in the Apple Developer Program and register the app's bundle ID.
- Deploy the production web application first. The iOS app loads the configured remote URL in a WebView, and the release build only allows HTTPS loads.
- Finish the app's identity: `ios.appBundleId`, `ios.appName`, the version, and `public/icon.png` (opaque, at least 1024x1024).
- Install a full Xcode 26 or newer. `catalyst setupEmulator:ios` checks it and finishes Xcode's first-launch setup.

## 1. Point the release at production

A release build uses `WEBVIEW_CONFIG.release`, deep-merged over the rest of `WEBVIEW_CONFIG`. Put the production host there and keep your LAN address in the base config for development:

```json title="config/config.json"
{
    "WEBVIEW_CONFIG": {
        "port": 3005,
        "LOCAL_IP": "192.168.1.20",
        "ios": {
            "appBundleId": "com.example.shop",
            "appName": "Shop",
            "developmentTeam": "ABCDE12345",
            "version": { "major": 2, "minor": 5, "patch": 0 }
        },
        "release": {
            "LOCAL_IP": "www.example.com",
            "port": 443,
            "useHttps": true,
            "apiBaseUrl": "https://api.example.com/"
        }
    }
}
```

The build fails with [IOS-007](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-007.md) when the start URL is localhost, a private or link-local address, a `.local` name, or this Mac's own address. An internal app on a private network can set `release.allowPrivateHost` to `true`. On iOS the app connects on port 443 whenever `useHttps` is set.

`release` changes the native config only. In bundled mode (`buildOptimisation`), build the web app for production with `catalyst build` first.

## 2. Version and build number

The version (`CFBundleShortVersionString`) comes from `ios.version.{major,minor,patch}`, or from the app's `package.json` version when `ios.version` is not set. Pre-release suffixes are dropped, so `2.5.0-beta.1` becomes `2.5.0`.

Every upload needs a build number (`CFBundleVersion`) higher than the last one for that version. The release build takes the first of `--build-number <n>`, the `CATALYST_BUILD_NUMBER` environment variable, and `ios.version.buildNumber`. Without one it fails with [IOS-008](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-008.md). In CI, pass the run number.

## 3. Set up signing

Pick one of the three ways below. The build fails with [IOS-010](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-010.md) when none of them is set up.

### Automatic signing with an App Store Connect API key (recommended)

Xcode creates or fetches the distribution certificate and profile itself. It needs your team ID and an App Store Connect API key with the Admin or App Manager role. Create the key in App Store Connect under Users and Access, Integrations, and download the `.p8` file once.

Keep the `.p8` outside the repository and point the config at it:

```json
"ios": {
    "developmentTeam": "ABCDE12345",
    "ascApiKey": {
        "path": "~/keys/AuthKey_A1B2C3D4E5.p8",
        "keyId": "A1B2C3D4E5",
        "issuerId": "69a6de70-0000-47e3-e053-5b8c7c11a4d1"
    }
}
```

The environment variables `CATALYST_ASC_KEY_PATH` (or `CATALYST_ASC_KEY_BASE64`, the base64 of the `.p8`), `CATALYST_ASC_KEY_ID` and `CATALYST_ASC_ISSUER_ID` override these fields one by one. A base64 key is written to a private temporary file for the build and deleted afterwards. A key with one of the three values missing fails with [IOS-011](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-011.md).

Without a key, automatic signing uses the Apple account signed in to Xcode (Xcode, Settings, Accounts) on that Mac, if there is one.

### Manual signing with an installed profile

If you already manage certificates and profiles yourself, set `ios.provisioningProfile` to the profile name. Put the App Store profile in the release block, so debug device builds keep using your development profile:

```json
"ios": { "developmentTeam": "ABCDE12345", "provisioningProfile": "Shop Development" },
"release": { "ios": { "provisioningProfile": "Shop App Store" } }
```

The distribution certificate must be in your login keychain.

### Manual signing in CI

Ephemeral CI machines should not create a new certificate on every run, so CI signs with an exported certificate and profile:

| Variable | Value |
|----------|-------|
| `CATALYST_IOS_P12_BASE64` | base64 of a `.p12` holding the Apple Distribution certificate and its private key |
| `CATALYST_IOS_P12_PASSWORD` | the `.p12` password |
| `CATALYST_IOS_PROFILE_BASE64` | base64 of the App Store `.mobileprovision` for `ios.appBundleId` |

The build imports the certificate into a temporary keychain, adds it to the keychain search list, and installs the profile. When the build ends, also on failure or Ctrl+C, it restores the original search list, deletes the keychain and removes the profile and the decoded files. Inputs that are missing, wrong or do not match the bundle ID fail with [IOS-012](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-012.md).

A GitHub Actions job looks like this:

```yaml
- run: npx catalyst buildApp:ios --release --build-number ${{ github.run_number }}
  env:
      CATALYST_IOS_P12_BASE64: ${{ secrets.IOS_P12_BASE64 }}
      CATALYST_IOS_P12_PASSWORD: ${{ secrets.IOS_P12_PASSWORD }}
      CATALYST_IOS_PROFILE_BASE64: ${{ secrets.IOS_PROFILE_BASE64 }}
```

## 4. Build the IPA

```bash
npm run buildApp:ios -- --release --build-number 12
```

Setting `ios.buildType` to `release` (any case) does the same as `--release`. The build:

1. merges `release`, checks the start URL and the build number;
2. writes the native config, entitlements and signing settings;
3. runs `xcodebuild archive` with the Release configuration for a generic iOS device;
4. exports the archive with `xcodebuild -exportArchive`, using `ios.exportMethod` (default `app-store-connect`; also `release-testing`, `enterprise` and `debugging`);
5. copies the IPA and the zipped dSYMs to the output folder.

The export keeps the version and build number Catalyst set. An unknown `ios.exportMethod` fails with [IOS-013](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-013.md).

`--no-sign` archives without signing and skips the export. It writes the `.xcarchive` to the same folder and is meant for CI checks that the release compiles, without any signing secrets.

## 5. Complete the release in App Store Connect

1. Upload the IPA with Transporter and wait for Apple to process it.
2. Test it through TestFlight.
3. Complete the store listing, privacy details, pricing and availability.
4. Select the build for the version and submit it for App Review.

Apple's release workflow is documented in [Distributing your app for beta testing and releases](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

## What the release build sets for you

- Push notifications: the `aps-environment` entitlement is only added when `WEBVIEW_CONFIG.notifications.enabled` is true. With automatic signing the archive is signed for development and the export re-signs it with the distribution profile, which sets `production`. A manually signed release writes `production` directly.
- Privacy manifest: the app ships a `PrivacyInfo.xcprivacy` declaring the required-reason APIs the Catalyst shell uses (UserDefaults, system boot time and file timestamps), no tracking and no collected data. Declare what your own web app collects in App Store Connect.
- Local HTTPS: the in-app file server's self-signed `localhost` certificate is generated on every build. It is only trusted for `localhost` inside the app.

## Generated project

The Xcode project lives inside the installed package (`node_modules/catalyst-core/dist/native/iosnativeWebView`) and is regenerated by every build and package install. Keep all release settings in `config/config.json`; edits made in Xcode do not last.

## Troubleshooting

| Error | Fix |
|-------|-----|
| [IOS-007](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-007.md) Release build points at a local or private host | Set `release.LOCAL_IP`, `port` and `useHttps` to the production host |
| [IOS-008](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-008.md) Release build has no build number | Pass `--build-number` or set `CATALYST_BUILD_NUMBER` |
| [IOS-010](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-010.md) iOS code signing is not set up | Set `ios.developmentTeam` with an API key, or one of the manual options above |
| [IOS-011](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-011.md) App Store Connect API key settings are incomplete or wrong | Give the key file, key ID and issuer ID |
| [IOS-012](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-012.md) Manual signing inputs are incomplete or wrong | Check the three `CATALYST_IOS_*` variables belong together |
| [IOS-006](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-006.md) App icon has transparency | Flatten `public/icon.png` onto a solid background |
