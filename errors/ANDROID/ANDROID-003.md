# ANDROID-003

**Category:** ANDROID

## Message

Release build has no build number

## Details

Google Play needs a new, higher versionCode for every upload. None was given through --build-number, the CATALYST_BUILD_NUMBER environment variable, or WEBVIEW_CONFIG.android.version.buildNumber.

## Suggested action

Pass --build-number <n>, set CATALYST_BUILD_NUMBER in CI, or set WEBVIEW_CONFIG.android.version.buildNumber.
