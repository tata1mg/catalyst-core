# NATIVE-002

**Category:** NATIVE

## Message

Invalid build number

## Details

The build number becomes the Android versionCode and the iOS CFBundleVersion. It is the whole minutes since 2024-01-01T00:00:00Z unless CATALYST_BUILD_NUMBER is set, and CATALYST_BUILD_NUMBER is not a whole number from 1 to 2100000000 (the largest value Google Play accepts).

## Suggested action

Unset CATALYST_BUILD_NUMBER to use the automatic build number, or set it to a whole number from 1 to 2100000000 that is higher than the last one you uploaded.
