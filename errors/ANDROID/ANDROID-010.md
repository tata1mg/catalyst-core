# ANDROID-010

**Category:** ANDROID

## Message

App icon is not usable

## Details

public/icon.png becomes the Android launcher icon when public/android/appIcons has no per-density icons, so it must be a PNG file, square, and at least 1024 by 1024 pixels.

## Suggested action

Replace public/icon.png with a square PNG of at least 1024x1024 pixels, or add per-density icons in public/android/appIcons.
