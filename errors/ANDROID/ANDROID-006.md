# ANDROID-006

**Category:** ANDROID

## Message

Upload key settings are incomplete or wrong

## Details

An upload keystore was found but cannot be used: its file is missing, no store password was given, or keytool rejected the password or alias.

## Suggested action

Check credentials/android/keystore.properties, or the CATALYST_ANDROID_* environment variables, against the keystore.
