# RUNTIME-NATIVE-019

**Category:** RUNTIME-NATIVE

## Message

No handler registered for this bridge interface

## Details

Native sent a callback for this interface, but your webview hasn't registered a handler for it yet.

## Suggested action

Call WebBridge.register() for this interface before native calls arrive.
