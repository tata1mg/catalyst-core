# RUNTIME-NATIVE-018

**Category:** RUNTIME-NATIVE

## Message

Invalid callback interface

## Details

The native platform invoked WebBridge.callback() with an interface name that isn't recognized.

## Suggested action

Check the interface name against the registered NATIVE_CALLBACKS list; this usually indicates a native/JS version mismatch.
