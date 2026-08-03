# RUNTIME-NATIVE-019

**Category:** RUNTIME-NATIVE

## Message

No handler registered for this bridge interface

## Details

The native platform called back on an interface that has no JS-side handler registered yet.

## Recoverable

Yes — you can fix this and retry without restarting your workflow.

## Suggested action

Ensure WebBridge.register() is called for this interface before the native call arrives.
