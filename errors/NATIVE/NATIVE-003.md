# NATIVE-003

**Category:** NATIVE

## Message

Release build uses a placeholder app id

## Details

The app id becomes the Android application id and the iOS bundle id, and a store listing is tied to it for good. It is a com.example.* id or one of the template defaults (io.yourname.androidproject, com.catalyst.framework.app, com.debug.webview), or none is set, so the template's default would ship.

## Suggested action

Set WEBVIEW_CONFIG.appId in config/config.json to your own reverse-DNS id, e.g. com.acme.shop.
