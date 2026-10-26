---
title: Universal App Deployment
slug: universal-app-deployment
id: universal-app-deployment
---

# Universal App Deployment

Use this flow for Android and iOS release delivery. Universal app deployment is driven by `WEBVIEW_CONFIG` in `config/config.json`, so treat configuration accuracy as part of the release process.

## Android Release Flow

1. Deploy the production web application over HTTPS.
2. Add a `WEBVIEW_CONFIG.release` block with the production values (see below).
3. Run `catalyst build`.
4. Run `npx catalyst buildApp:android --release --build-number <n>`.
5. Upload the signed `.aab` from `build-output/` to Google Play.

`--release` builds the signed bundle whatever `WEBVIEW_CONFIG.android.buildType` says. Setting `android.buildType` to `release` still works and does the same thing. Through npm scripts, pass the flags after `--`, for example `npm run buildApp:android -- --release --build-number 12`.

### Production values

A release build deep-merges `WEBVIEW_CONFIG.release` over the rest of `WEBVIEW_CONFIG`, so the same config file serves the emulator during development and the store build. Objects are merged key by key; arrays and plain values in `release` replace the base value. The `release` block itself never ships in the app.

```json title="config/config.json"
{
  "WEBVIEW_CONFIG": {
    "LOCAL_IP": "192.168.1.20",
    "port": 3005,
    "apiBaseUrl": "https://api.example.com/",
    "android": {
      "packageName": "com.example.shop",
      "version": { "major": 1, "minor": 4, "patch": 0 }
    },
    "release": {
      "LOCAL_IP": "www.example.com",
      "port": 443,
      "useHttps": true
    }
  }
}
```

The app opens `http(s)://<LOCAL_IP>:<port>/<initial_url>`. A release build fails with [ANDROID-002](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-002.md) when that host is `localhost`, a loopback, RFC 1918, link-local or `.local` address, or the build machine's own address, because users' devices cannot reach it. Apps that only run on a private network can set `release.allowPrivateHost` to `true`, which turns the failure into a warning. A release over plain HTTP prints a warning.

Without a `release` block the build uses the base values and prints a deprecation warning. Apps that already point `LOCAL_IP` at their production host keep working; apps whose `LOCAL_IP` is a LAN address now fail instead of shipping it.

The `release` block changes native configuration only. With `android.buildOptimisation` on, the bundled web assets come from `build/`, so run a production `catalyst build` first. A release honours `android.buildOptimisation` rather than forcing it on.

### Version and build number

The version name comes from `WEBVIEW_CONFIG.android.version.{major,minor,patch}`, or from the app's `package.json` version when that block is absent. The build number becomes the `versionCode`. Catalyst takes the first of these that is set:

1. `--build-number <n>`
2. the `CATALYST_BUILD_NUMBER` environment variable
3. `WEBVIEW_CONFIG.android.version.buildNumber`

A release build without one fails with [ANDROID-003](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-003.md). The value must be a whole number from 1 to 2100000000 and higher than the last upload. Debug builds default to 1.

`WEBVIEW_CONFIG.android.packageName` is the application id for release and debug builds; debug builds add `.debug`, so both can be installed side by side.

### Upload key

Google Play only accepts updates signed with the same upload key, so Catalyst keeps one key per app at `credentials/android/upload.jks`, with its alias and generated password in `credentials/android/keystore.properties` (file mode 0600). The first release build in a terminal offers to create the key and adds `credentials/` to the app's `.gitignore`. Back up `credentials/android/`: a lost upload key can only be replaced through Play's upload key reset.

In CI, provide the key through environment variables instead:

| Variable | Purpose |
|----------|---------|
| `CATALYST_ANDROID_KEYSTORE_BASE64` | The keystore file, base64-encoded. Written to a temp file for the build and deleted afterwards |
| `CATALYST_ANDROID_STORE_PASSWORD` | Keystore password |
| `CATALYST_ANDROID_KEY_PASSWORD` | Key password. Defaults to the store password |
| `CATALYST_ANDROID_KEY_ALIAS` | Key alias. Defaults to `android.signing.keyAlias`, then `upload` |
| `CATALYST_BUILD_NUMBER` | Build number, for example the CI run number |

`WEBVIEW_CONFIG.android.signing.storeFile` can point at a keystore elsewhere in the app instead of `credentials/android/upload.jks`. The variables above override `keystore.properties` when both are present. Passwords are handed to `keytool` and Gradle through environment variables and never appear on a command line or in the build output. A release with no key and no terminal fails with [ANDROID-005](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-005.md); a key that cannot be opened fails with [ANDROID-006](https://github.com/tata1mg/catalyst-core/blob/main/errors/ANDROID/ANDROID-006.md).

`android.keystoreConfig.organizationInfo` still supplies the certificate details for a new key. Passwords in `android.keystoreConfig` or `android.keystore` are no longer used for signing and print a warning; move them to `keystore.properties` or CI secrets. If an earlier release left `build-output/<name>-keystore.jks`, the next release build in a terminal offers to adopt it as the upload key.

Catalyst 1.1.0 and earlier shipped a shared keystore inside the Android template and generated a new key on every release build. If you uploaded a build signed with either, request an upload key reset in Play Console and register the key in `credentials/android/`.

## iOS Release Flow

1. Deploy the production web application over HTTPS.
2. Finalize `WEBVIEW_CONFIG`, the bundle identifier, version, build number, capabilities, and app assets.
3. Run `npm run buildApp:ios` from the consuming Catalyst app.
4. Open the generated `iosnativeWebView.xcodeproj` and configure Release signing.
5. Archive the `iosnativeWebView` scheme with a generic iOS device destination.
6. Validate and upload the archive through Xcode.
7. Complete TestFlight testing and the App Store Connect release.

`npm run buildApp:ios` prepares the package-owned Xcode project and performs a Debug native build. It does not create the App Store archive. The production artifact is created by the scheme's Release Archive action in Xcode. This flow is the same for Catalyst `0.2.x` and `0.3.x`.

See [Building and Releasing a Catalyst iOS App](/content/Deployment/ios-production-release) for the complete release procedure and checklist.

## What to Validate Before Release

- API host and environment values in `WEBVIEW_CONFIG.release`
- `LOCAL_IP`, `port`, and access-control rules for the target environment
- app version and build number
- the upload key in `credentials/android/` is backed up
- deep links and route handling
- offline and cache behavior
- runtime permissions (camera/files/notifications)
- store metadata, signing, and bundle identifiers

## Related Docs

- [Configuration API](/content/11-API%20Reference/02-Configuration.mdx)
- [Android Build Optimization](/content/Best%20Practices/android-build-optimization)
- [Security](/content/Best%20Practices/security)
- [Universal App Cache Management](/content/Core%20Concepts/universal-app-cache-management)
