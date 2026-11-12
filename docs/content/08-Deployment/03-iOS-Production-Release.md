---
title: Building and Releasing a Catalyst iOS App
slug: ios-production-release
id: ios-production-release
---

# Building and Releasing a Catalyst iOS App

`npm run ios:release` produces the signed IPA for TestFlight and the App Store. Xcode has to be installed, but you never open it: the CLI archives the app, signs it and exports the IPA, on your Mac and in CI.

```bash
npm run ios:release
```

In apps created before 1.2.0, run `npm run buildApp:ios -- --release`.

The IPA and its zipped debug symbols land in `build-output/ios/<version>-<build>/` inside your app, for example `build-output/ios/2.5.0-1497600/Acme-Shop.ipa` and `Acme-Shop-dSYMs.zip`. Uploading is up to you; see [Upload to TestFlight](#4-upload-to-testflight).

## Before you begin

- Enroll the releasing Apple account in the Apple Developer Program.
- Register the bundle ID (your `appId`) under Certificates, Identifiers & Profiles, and create the app in App Store Connect (Apps > + > New App) with that bundle ID.
- Deploy the production web application over HTTPS and set `WEBVIEW_CONFIG.url` to it. The app loads that URL in a WebView.
- Finish the app's identity: `appId`, `appName`, the `version` in `package.json`, and `public/icon.png` (opaque, at least 1024x1024).
- Install a full Xcode 26 or newer. The build checks it and offers to finish Xcode's first-launch setup.
- Sign in to Xcode with the Apple account that is in your company's developer team: Xcode > Settings > Accounts.

## 1. Configure the release

```json title="config/config.json"
{
    "WEBVIEW_CONFIG": {
        "appId": "com.acme.shop",
        "appName": "Acme Shop",
        "url": "https://shop.acme.com",
        "ios": {
            "developmentTeam": "ABCDE12345"
        }
    }
}
```

`developmentTeam` is your 10-character team ID, under Membership details at developer.apple.com/account. On a Mac signed in to Xcode you can leave it out; see [Set up signing](#2-set-up-signing). The build fails with [NATIVE-001](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-001.md) when `url` is localhost, a private or link-local address, a `.local` name or this Mac's own address, and with [NATIVE-003](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-003.md) for a placeholder app id. Run in a terminal, the build asks for a missing app id or website instead and saves the answer to `config/config.json`. An internal app on a private network can set `allowPrivateHost` to `true`. On iOS the app always connects on port 443 over HTTPS.

The version (`CFBundleShortVersionString`) comes from `package.json`, without any pre-release suffix. The build number (`CFBundleVersion`) is the number of minutes since 2024-01-01 UTC, or `CATALYST_BUILD_NUMBER` when set. See [Version and Build Number](/content/Deployment/universal-app-deployment#version-and-build-number).

## 2. Set up signing

The release signs with the first of these it finds:

1. A `.p12` and its profile in `credentials/ios/` (local signing).
2. `ios.provisioningProfile`, the name of a profile you installed yourself, with its certificate in your login keychain.
3. An App Store Connect API key in `credentials/ios/` (cloud signing).
4. An App Store profile installed on this Mac for this exact app id, with its certificate in your keychain, for example one Xcode downloaded. The newest valid one is used, and the team comes from it. Wildcard, development, ad hoc and enterprise profiles are skipped, and with notifications on the profile must include push notifications. This step only applies when `ios.exportMethod` is `app-store-connect`, the default. Run in a terminal, the build saves the profile it picked as `ios.provisioningProfile` (its name, or its UUID when another installed profile has the same name), so later releases sign with it through step 2. In CI it is used for that build only.
5. The Apple account signed in to Xcode. The team is read from Xcode's accounts: one team is used as it is, and with several the build asks once in a terminal. In a terminal the team is saved as `ios.developmentTeam`; in CI it is used for that build only. Personal teams cannot publish to the App Store and are skipped.

So on your own Mac, with Xcode signed in, `npm run ios:release` needs no files in `credentials/ios/`. The files are for CI, where no one is signed in to Xcode. When none of the five is there, the build fails with [IOS-010](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-010.md) and asks you to open Xcode > Settings > Accounts and sign in, or to set `ios.developmentTeam`. When Xcode itself refuses to sign, the error includes Xcode's line saying why.

When a release saves `ios.provisioningProfile` or `ios.developmentTeam`, review the change to `config/config.json` and commit it. A saved `ios.provisioningProfile` pins every later release to that profile, even after you install a newer one. Remove the key to let the build pick again.

### Signing files

Signing files live in `credentials/ios/` in your app. New apps list `credentials/` in `.gitignore`; add it to an older app's `.gitignore` before you put files there:

```text
credentials/ios/
  AuthKey_<KEYID>.p8          cloud signing: the App Store Connect API key
  signing.properties          ascIssuerId=..., ascKeyId=... (optional), p12Password=...
  distribution.p12            local signing: Apple Distribution certificate and private key
  AppStore.mobileprovision    local signing: App Store profile for the app id
```

Keep at most one file of each kind. Back the folder up with `npx catalyst credentials:export ios`; the same value is the CI secret.

### Cloud signing with an API key (recommended for CI)

Xcode creates or fetches a cloud-managed distribution certificate and the App Store profile itself, so there is nothing to export from Keychain Access.

1. In App Store Connect, go to Users and Access > Integrations > App Store Connect API and create a team key with the Admin role. Cloud-managed certificates need Admin.
2. Download `AuthKey_<KEYID>.p8`. Apple lets you download it only once.
3. Put it in `credentials/ios/` and create `credentials/ios/signing.properties` with the issuer ID shown above the list of keys:

```properties title="credentials/ios/signing.properties"
ascIssuerId=69a6de70-0000-47e3-e053-5b8c7c11a4d1
```

Add `ascKeyId=<KEYID>` only if you renamed the `.p8` file. Cloud signing also needs `ios.developmentTeam`. A key with a value missing fails with [IOS-011](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-011.md).

### Local signing with a .p12 and a profile

If you manage certificates yourself, export the Apple Distribution certificate with its private key from Keychain Access as a `.p12`, download the App Store provisioning profile for your `appId`, and put both in `credentials/ios/` with the `.p12` password:

```properties title="credentials/ios/signing.properties"
p12Password=the-password-you-chose
```

For a release, the `.p12` wins over an API key in the same folder. The build imports the certificate into a temporary keychain and installs the profile. When the build ends, also on failure or Ctrl+C, it restores your keychain search list and removes the keychain and the profile it installed. Files that are missing, wrong or for another bundle ID fail with [IOS-012](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-012.md).

## 3. Build the IPA

```bash
npm run ios:release
```

The build:

1. resolves the config: `url`, `appId`, version and build number, and how to sign;
2. writes the native config, entitlements and signing settings;
3. runs `xcodebuild archive` with the Release configuration for a generic iOS device;
4. exports the archive with `xcodebuild -exportArchive`, using `ios.exportMethod` (default `app-store-connect`; also `release-testing`, `enterprise` and `debugging`);
5. copies the IPA and the zipped dSYMs to `build-output/ios/<version>-<build>/`.

The export keeps the version and build number Catalyst set. An unknown `ios.exportMethod` fails with [IOS-013](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-013.md). The archive itself is not kept, so the build does not show up in Xcode's Organizer.

## 4. Upload to TestFlight

Catalyst does not upload. Use Apple's Transporter app from the Mac App Store: sign in with your Apple account, drag in the IPA from `build-output/ios/<version>-<build>/` and choose Deliver.

Apple processes the build for a few minutes and emails you when it is ready. Then add it to an internal testing group in the app's TestFlight tab. The release build sets `ITSAppUsesNonExemptEncryption` to `false`, because the app only uses the encryption built into iOS, so TestFlight does not ask the export compliance question.

## 5. Complete the release in App Store Connect

1. Test the build through TestFlight.
2. Complete the store listing, privacy details, pricing and availability.
3. Select the build for the version and submit it for App Review.

Apple's release workflow is documented in [Distributing your app for beta testing and releases](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

## CI

Run `npx catalyst credentials:export ios`, store the output as the `CATALYST_IOS_CREDENTIALS` repository secret, and run `npm run ios:release -- --yes --accept-licenses` on a macOS runner with a pinned Xcode. Cloud signing suits CI best, because no certificate has to be exported. [Native CI](/content/Deployment/universal-app-deployment#native-ci) has the complete workflow.

## What the release build sets for you

- Push notifications: the `aps-environment` entitlement is only added when `WEBVIEW_CONFIG.notifications.enabled` is true. With automatic signing the archive is signed for development and the export re-signs it with the distribution profile, which sets `production`. A manually signed release, including one signed with an installed profile the build picked, writes `production` directly.
- Privacy manifest: the app ships a `PrivacyInfo.xcprivacy` declaring the required-reason APIs the Catalyst shell uses (UserDefaults, system boot time and file timestamps), no tracking and no collected data. Declare what your own web app collects in App Store Connect.
- Export compliance: `ITSAppUsesNonExemptEncryption` is `false`.
- Local HTTPS: the in-app file server's self-signed `localhost` certificate is generated on every build. It is only trusted for `localhost` inside the app.

## Generated project

The Xcode project lives inside the installed package (`node_modules/catalyst-core/dist/native/iosnativeWebView`) and is regenerated by every build and package install. Keep all release settings in `config/config.json`; edits made in Xcode do not last.

## Troubleshooting

| Error | Fix |
|-------|-----|
| [NATIVE-001](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-001.md) Release build points at a local or private host | Set `WEBVIEW_CONFIG.url` to your production address, pass `--url`, or run the build in a terminal and type the address |
| [NATIVE-003](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-003.md) Release build uses a placeholder app id | Set `WEBVIEW_CONFIG.appId` or `ios.bundleIdentifier` to your own bundle ID, or run the build in a terminal and type it |
| [IOS-010](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-010.md) iOS code signing is not set up | Sign in to Xcode > Settings > Accounts with your company team's account. For CI, set `ios.developmentTeam` and add an API key, or a `.p12` and profile, to `credentials/ios/` |
| [IOS-011](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-011.md) App Store Connect API key settings are incomplete or wrong | Keep one `AuthKey_<KEYID>.p8` and an `ascIssuerId` line in `signing.properties` |
| [IOS-012](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-012.md) Manual signing inputs are incomplete or wrong | Check that the `.p12`, its password and the profile belong together and match `appId` |
| [IOS-006](https://github.com/tata1mg/catalyst-core/blob/main/errors/IOS/IOS-006.md) App icon has transparency | Flatten `public/icon.png` onto a solid background |
