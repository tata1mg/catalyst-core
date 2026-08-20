# RUNTIME-NATIVE-021

**Category:** RUNTIME-NATIVE

## Message

Invalid bridge callback registration

## Details

WebBridge.register() was called with a non-function callback or an unrecognized interface name.

## Suggested action

Pass a function as the callback and a valid interface name from NATIVE_CALLBACKS.
