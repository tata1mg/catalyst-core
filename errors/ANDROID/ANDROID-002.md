# ANDROID-002

**Category:** ANDROID

## Message

Release build points at a local or private host

## Details

The release start URL, built from WEBVIEW_CONFIG.release merged over WEBVIEW_CONFIG (useHttps, LOCAL_IP, port), names localhost, a loopback, RFC 1918, link-local or .local address, or this machine's own address. Users' devices cannot reach it, so the store build would open on an error page.

## Suggested action

Set WEBVIEW_CONFIG.release.LOCAL_IP (and port/useHttps) to your production host, or set WEBVIEW_CONFIG.release.allowPrivateHost to true for an internal app on a private network.
