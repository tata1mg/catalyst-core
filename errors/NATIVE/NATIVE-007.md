# NATIVE-007

**Category:** NATIVE

## Message

The credentials secret could not be unpacked

## Details

CATALYST_ANDROID_CREDENTIALS and CATALYST_IOS_CREDENTIALS hold a base64 gzipped tar of credentials/<platform>/, as printed by catalyst credentials:export. The value is not one, is cut short, or holds links or paths outside the folder.

## Suggested action

Run catalyst credentials:export <android|ios> where credentials/<platform>/ exists and paste the whole value into the secret again.
