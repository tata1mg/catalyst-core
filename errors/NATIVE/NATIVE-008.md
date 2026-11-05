# NATIVE-008

**Category:** NATIVE

## Message

No credentials to export

## Details

catalyst credentials:export packs credentials/<platform>/ in the app root, and that folder is missing or empty. A first release build creates it (the Android upload key), or you add the iOS signing files to it.

## Suggested action

Run the command from the app root after a release build has created credentials/<platform>/.
