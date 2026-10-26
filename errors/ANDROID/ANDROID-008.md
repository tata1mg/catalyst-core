# ANDROID-008

**Category:** ANDROID

## Message

Android SDK setup needs your confirmation

## Details

setupEmulator:android found Android SDK pieces to download (command-line tools, packages or a system image), an emulator to create, or SDK licences to accept. Downloads only happen after a yes in an interactive terminal or with --yes, and licences are only accepted interactively or with --accept-licenses.

## Suggested action

Run catalyst setupEmulator:android in a terminal, or pass --yes to allow the downloads and --accept-licenses to accept the Android SDK licences (for CI).
