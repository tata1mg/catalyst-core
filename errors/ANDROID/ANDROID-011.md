# ANDROID-011

**Category:** ANDROID

## Message

No Android phone connected

## Details

buildApp:android --device installs the app on a phone that adb can reach, but adb lists none that is ready: no phone is connected, USB debugging is off, the phone has not allowed this computer yet (adb shows it as unauthorized), or ANDROID_SERIAL names a phone that is not connected.

## Suggested action

Connect the phone, turn on USB debugging in Developer options, accept the Allow USB debugging prompt on the phone and check that adb devices lists it. Or drop --device to use the emulator.
