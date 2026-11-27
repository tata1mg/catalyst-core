# ANDROID-005

**Category:** ANDROID

## Message

No upload key for the release build

## Details

A release build signs the app bundle with the app's upload key. None was found in credentials/android/ or in the CATALYST_ANDROID_CREDENTIALS secret. A new key is only created after a yes in an interactive terminal, and never for an app that is already on Google Play.

## Suggested action

Run catalyst buildApp:android --release once in a terminal to create credentials/android/upload.jks, then back it up with catalyst credentials:export android. In CI, set the CATALYST_ANDROID_CREDENTIALS secret to the output of catalyst credentials:export android.
