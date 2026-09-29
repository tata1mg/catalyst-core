# RUNTIME-NATIVE-022

**Category:** RUNTIME-NATIVE

## Message

WebBridge could not be initialized

## Details

WebBridge.init() was called outside a browser environment (no `window` available).

## Suggested action

Call WebBridge.init() in a browser environment, before using bridge features.
