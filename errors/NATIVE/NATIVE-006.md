# NATIVE-006

**Category:** NATIVE

## Message

The dev server did not answer

## Details

A debug build loads the app from the dev server. The CLI started it with catalyst start and waited for it to answer, but it exited, did not answer in time, or is running where the device cannot reach it.

## Suggested action

Run npm start on its own to see why the server does not start, then run the build again.
