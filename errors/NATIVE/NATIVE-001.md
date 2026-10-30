# NATIVE-001

**Category:** NATIVE

## Message

Release build points at a local or private host

## Details

A release build (buildApp:android --release or buildApp:ios --release) would open a start URL on localhost, a loopback, private (RFC 1918), link-local or .local address, this machine's own address, or a reserved placeholder domain such as example.com. Users' devices cannot reach it, so the store build would open on an error page. The start URL comes from --url, then WEBVIEW_CONFIG.url, then the older LOCAL_IP, port and useHttps keys.

## Suggested action

Set WEBVIEW_CONFIG.url to your production origin (e.g. https://shop.acme.com) or pass --url, or set WEBVIEW_CONFIG.allowPrivateHost to true for an internal app on a private network.
