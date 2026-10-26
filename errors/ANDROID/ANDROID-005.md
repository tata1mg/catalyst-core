# ANDROID-005

**Category:** ANDROID

## Message

No upload key for the release build

## Details

A release build signs the app bundle with the app's upload key. None was found at credentials/android/upload.jks, android.signing.storeFile or CATALYST_ANDROID_KEYSTORE_BASE64, and a new key is only created after a yes in an interactive terminal.

## Suggested action

Run the release build once in a terminal to create credentials/android/upload.jks, or in CI set CATALYST_ANDROID_KEYSTORE_BASE64 and CATALYST_ANDROID_STORE_PASSWORD (plus CATALYST_ANDROID_KEY_ALIAS and CATALYST_ANDROID_KEY_PASSWORD when they differ from the defaults).
