# ANDROID-006

**Category:** ANDROID

## Message

Upload key settings are incomplete or wrong

## Details

An upload key was found but cannot be used: the keystore or its keystore.properties is missing, no store password was given, or keytool rejected the password or alias.

## Suggested action

Check credentials/android/keystore.properties against credentials/android/upload.jks. In CI, run catalyst credentials:export android again and update the CATALYST_ANDROID_CREDENTIALS secret.
