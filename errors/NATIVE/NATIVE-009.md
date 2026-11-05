# NATIVE-009

**Category:** NATIVE

## Message

Credentials are too large for one secret

## Details

A GitHub Actions secret holds at most 48 KB, and credentials/<platform>/ packs to more than that.

## Suggested action

Remove files the build does not need from credentials/<platform>/ (only signing keys, profiles and their settings belong there), then export again.
