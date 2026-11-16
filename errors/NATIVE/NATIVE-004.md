# NATIVE-004

**Category:** NATIVE

## Message

Invalid production URL

## Details

WEBVIEW_CONFIG.url and --url take an origin: an http:// or https:// scheme, a host and an optional port, with no path, query, fragment or user name. HTTPS must use port 443, because the iOS app always loads HTTPS on 443.

## Suggested action

Use an origin such as https://shop.acme.com, without a path or a port other than 443.
