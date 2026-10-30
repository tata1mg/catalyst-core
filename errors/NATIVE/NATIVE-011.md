# NATIVE-011

**Category:** NATIVE

## Message

A release with this version and build number already exists

## Details

build-output/<platform>/<version>-<build>/ already holds a store artifact. The build number counts whole minutes, so two releases in the same minute get the same number, and a store refuses a build number it has already seen.

## Suggested action

Wait a minute and run the release again, or set CATALYST_BUILD_NUMBER to a higher number. To rebuild the same build on purpose, delete that folder first.
