---
title: Universal App Deployment
slug: universal-app-deployment
id: universal-app-deployment
---

# Universal App Deployment

Store builds come from the Catalyst CLI: `npm run android:release` writes a signed Android App Bundle and `npm run ios:release` a signed IPA. Uploading them to Google Play and App Store Connect is manual. For a first release from start to finish, follow [Releasing a Full App](/content/Deployment/releasing-a-full-app).

## Configure the App

A release reads four keys at the top of `WEBVIEW_CONFIG`:

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "appId": "com.acme.shop",
    "appName": "Acme Shop",
    "url": "https://shop.acme.com",
    "allowPrivateHost": false
  }
}
```

| Key | Meaning |
|-----|---------|
| `appId` | The Android application id and the iOS bundle id. It wins over `android.packageName`, `ios.appBundleId` and `ios.bundleIdentifier`, which still work in apps that have no `appId` |
| `appName` | The name under the app icon. It wins over `android.appName` and `ios.appName` |
| `url` | The address of your deployed web app: `https://` and a host, with no path. The app opens it on launch. HTTPS uses port 443; plain HTTP works with a warning |
| `allowPrivateHost` | `true` lets a release load a private or local host, for internal apps on a private network. Defaults to `false` |

A release build fails early when something here would ship a broken app:

- [NATIVE-003](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-003.md) when the app id is a placeholder: any `com.example.` id, or the template ids `io.yourname.androidproject` and `com.catalyst.framework.app`.
- [NATIVE-001](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-001.md) when the URL is `localhost`, a private or link-local address, a `.local` name, this machine's own address, or a reserved example domain. `allowPrivateHost: true` turns this into a warning.
- [NATIVE-004](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-004.md) when the URL is not an origin, for example when it has a path, or uses HTTPS on a port other than 443.

`--url <url>` overrides `url` for one build, for example `npm run android:release -- --url https://staging.acme.com`. Debug builds ignore `url` and load the dev server. Apps without `url` keep working: a release then uses `LOCAL_IP`, `port` and `useHttps` as before.

`buildType: "release"` in `WEBVIEW_CONFIG.android` or `WEBVIEW_CONFIG.ios` still builds a release, with a deprecation warning. Use the release scripts instead.

## Version and Build Number

The version comes from the `version` in your app's `package.json`. iOS drops a pre-release suffix, so `2.5.0-beta.1` becomes `2.5.0`. Bump it in `package.json` before each store release.

The build number (Android `versionCode`, iOS `CFBundleVersion`) is the number of whole minutes since 2024-01-01 00:00 UTC at build time. It rises with every build without any state to keep, and two builds made in the same minute get the same number. To set it yourself, for example because the app already uploaded a larger number, set `CATALYST_BUILD_NUMBER` to a whole number from 1 to 2100000000; anything else fails with [NATIVE-002](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-002.md). Do not set it to a CI run number after uploading clock-based builds: the stores reject a lower number.

A release writes to `build-output/<platform>/<version>-<build>/`. When that folder already holds an AAB or IPA, for example from a second release in the same minute, the build stops with [NATIVE-011](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-011.md) instead of overwriting it. Wait a minute, set `CATALYST_BUILD_NUMBER`, or delete the folder to rebuild the same build.

An app that set `WEBVIEW_CONFIG.ios.version` (`major`, `minor`, `patch`, `buildNumber`) before 1.3.0 keeps that iOS version and build number, so an app already in the App Store never ships a lower one. The build prints a deprecation warning: move the version to `package.json`, set `CATALYST_BUILD_NUMBER` if you need a build number above the clock's, and remove `ios.version`. `CATALYST_BUILD_NUMBER` wins over `ios.version.buildNumber`.

## Android Release

```bash
npm run android:release
```

The upload key signs every update, and Google Play only accepts updates signed with the same key. Catalyst keeps one key per app in `credentials/android/`: `upload.jks` (PKCS12) and `keystore.properties` (file mode 0600) with its alias and generated password. The first release in a terminal:

1. asks whether to create the key;
2. asks whether the app was uploaded to Google Play before. If it was, it stops: a new key would be rejected. Put the original key in `credentials/android/`, or ask Google for an [upload key reset](https://support.google.com/googleplay/android-developer/answer/9842756);
3. creates the key, adds `credentials/` to `.gitignore`, and tells you to back it up with `npx catalyst credentials:export android`, which prints the folder as one value. Keep it somewhere safe, such as a password manager. The same value is the CI secret.

A key is never created without a terminal, even with `--yes`; that case fails with [ANDROID-005](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-005.md). A key that cannot be opened fails with [ANDROID-006](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-006.md). Passwords reach `keytool` and Gradle through environment variables and never appear on a command line.

The build writes to `build-output/android/<version>-<build>/`:

- `<app name>.aab`, the bundle to upload
- `upload_certificate.pem`, the upload certificate. Play asks for it when you register or reset an upload key

`android.outputPath` moves the folder. The app targets Android API 36 (minimum 24), and its 64-bit native libraries are aligned for 16 KB memory pages, which Google Play requires for apps that target Android 15 and later.

To upload, open the app in Play Console and go to Test and release > Testing > Internal testing. Create a release, upload the `.aab`, then review and roll it out to your tester list. On the first upload, Play App Signing keeps the app signing key and your key becomes the upload key.

With `android.buildOptimisation` on, the bundled web assets come from `build/`, so run a production `catalyst build` first. Otherwise the app loads `url` and needs no web build.

Older apps: passwords in `android.keystoreConfig` or `android.keystore` are no longer used and print a warning; move them to `credentials/android/keystore.properties`. If an earlier release left `build-output/<name>-keystore.jks`, the next release in a terminal offers to adopt it as the upload key. Catalyst 1.1.0 and earlier shipped a shared keystore inside the Android template and generated a new key on every release build. If you uploaded a build signed with either, request an upload key reset in Play Console and put the new key in `credentials/android/`.

## iOS Release

```bash
npm run ios:release
```

Signing files go in `credentials/ios/`: an App Store Connect API key for cloud signing, or a `.p12` and provisioning profile for local signing. The IPA and zipped dSYMs land in `build-output/ios/<version>-<build>/`. See [Building and Releasing a Catalyst iOS App](/content/Deployment/ios-production-release) for both signing modes and the TestFlight upload.

## Native CI

CI needs one secret per platform. Each holds the whole `credentials/<platform>/` folder:

```bash
npx catalyst credentials:export android   # value for CATALYST_ANDROID_CREDENTIALS
npx catalyst credentials:export ios       # value for CATALYST_IOS_CREDENTIALS
```

Add the output as a repository secret under Settings > Secrets and variables > Actions. The value is a base64 gzipped tar and must stay under 48 KB ([NATIVE-009](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-009.md)). When `credentials/<platform>/` is not in the checkout, the build unpacks the secret into a private temporary folder, deletes it afterwards, and under GitHub Actions masks every password it reads. A value that cannot be unpacked fails with [NATIVE-007](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-007.md). After you change the signing files, export again and update the secret.

The workflow below is a template, not generated by Catalyst. Save it as `.github/workflows/catalyst-native.yml`, delete the job for a platform you do not ship, and keep the pinned versions up to date. It runs on a pushed `v*` tag or by hand, and uploads the store files as workflow artifacts. Nothing is published to a store.

```yaml title=".github/workflows/catalyst-native.yml"
name: Catalyst native release

on:
    workflow_dispatch:
    push:
        tags: ["v*"]

permissions:
    contents: read

jobs:
    android:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
            - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
              with:
                  node-version: 22
                  cache: npm
            - run: npm ci
            - uses: actions/setup-java@b6effb05e454b25005698d916606bdc6ffcbf961 # v5.7.0
              with:
                  distribution: temurin
                  java-version: "17"
            # The app loads your deployed site, so the web build is not bundled. With
            # android.buildOptimisation on, add `- run: npm run build` before this step.
            - name: Build the signed AAB
              run: npm run android:release -- --yes --accept-licenses
              env:
                  CATALYST_ANDROID_CREDENTIALS: ${{ secrets.CATALYST_ANDROID_CREDENTIALS }}
            - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
              with:
                  name: android-aab
                  path: build-output/android/
                  if-no-files-found: error

    ios:
        runs-on: macos-26
        steps:
            - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
            # Pinned, so a runner image update does not change the SDK the app is built with.
            - run: sudo xcode-select -s /Applications/Xcode_26.5.app
            - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
              with:
                  node-version: 22
                  cache: npm
            - run: npm ci
            - name: Build the signed IPA
              run: npm run ios:release -- --yes --accept-licenses
              env:
                  CATALYST_IOS_CREDENTIALS: ${{ secrets.CATALYST_IOS_CREDENTIALS }}
            - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
              with:
                  name: ios-ipa
                  path: build-output/ios/
                  if-no-files-found: error
```

The secrets reach the build through `env:` only. The build number comes from the clock, so the workflow needs no counter. For cloud signing, `WEBVIEW_CONFIG.ios.developmentTeam` must be set in the committed `config/config.json`.

## Agents and Scripts

The native commands never prompt when there is no terminal (stdin and stdout are not both TTYs) or when `CI` is set. Every answer comes from five flags:

| Flag | Effect |
|------|--------|
| `--release` | Build the signed store release |
| `--device` | Run the debug build on the connected phone instead of the emulator or simulator |
| `--url <url>` | The release's production URL, over `WEBVIEW_CONFIG.url` |
| `--yes` | Allow installs and downloads: JDK, SDK packages, emulator, simulator runtime, simulator, Xcode first launch |
| `--accept-licenses` | Accept the Android SDK licences and the Xcode licence |

`--yes` never accepts a licence and never creates a signing key. A step that needs an answer it was not given fails at once with [NATIVE-005](https://github.com/tata1mg/catalyst-core/blob/main/errors/NATIVE/NATIVE-005.md), and the message names the flag that answers it. Creating the Android upload key always needs a person at a terminal.

## What to Validate Before Release

- `appId`, `appName`, `url` and the `package.json` version
- API hosts and access-control rules for production
- the upload key in `credentials/android/` and the files in `credentials/ios/` are backed up
- deep links and route handling
- offline and cache behavior
- runtime permissions (camera, files, notifications)
- store metadata and screenshots

## Related Docs

- [Releasing a Full App](/content/Deployment/releasing-a-full-app)
- [Configuration API](/content/11-API%20Reference/02-Configuration.mdx)
- [Android Build Optimization](/content/Best%20Practices/android-build-optimization)
- [Security](/content/Best%20Practices/security)
- [Universal App Cache Management](/content/Core%20Concepts/universal-app-cache-management)
