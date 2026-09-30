# Catalyst Companion — Native Preview

Catalyst Companion lets a developer scan or enter a Catalyst app URL and run
that app inside Companion with the native bridges compiled into the Companion
binary.

## Architecture

`CompanionPlugin` installs the previewed app's runtime `WEBVIEW_CONFIG`, adds
native exit controls, and loads the confirmed URL in Companion's native WebView
shell.

Android recreates `MainActivity`; iOS replaces its `WKWebView`. Both paths then
construct the WebView and bridges through their normal initialization code with
the temporary runtime config. There is no preview Activity or parallel preview
WebView.

## Flow

1. `TryApp` scans or accepts an `https` URL. Cleartext `http` is accepted only
   for localhost and private-network hosts.
2. `TryApp` calls `io.catalyst.companion.openPreview`.
3. Native code fetches `GET /__catalyst/preview-config` from the target origin.
4. A native dialog shows the origin and whether runtime config was loaded, and
   warns that the app receives full native bridge access.
5. On confirmation, Companion installs the runtime config, reconstructs its
   WebView and bridges, adds native exit controls, and loads the confirmed URL.
6. Tapping the preview banner or shaking the device opens the native exit
   sheet. Android Back opens the same sheet.
7. Exit restores Companion's properties, loads the Companion home URL, clears
   preview history, and removes the native chrome.

## Runtime configuration

The preview-config response has schema version `1` and contains the app's full
platform-neutral `WEBVIEW_CONFIG`. The `android` and `ios` sections are excluded
because they contain build, signing, and machine-specific settings that cannot
configure a running WebView.

Both clients reject invalid JSON, redirects, unsupported schemas, and responses
larger than 64 KiB. They use three-second timeouts. When the endpoint is
unavailable, Companion uses its own runtime defaults.

The endpoint is available only from `catalyst start`; production servers do not
expose local runtime configuration.

## Trust and lifecycle

- The confirmed page receives Companion's compiled `NativeBridge` and
  `PluginBridge`; preview is not a sandbox.
- A preview can configure only capabilities already present in the Companion
  binary.
- The confirmation dialog and persistent banner are native views that web
  content cannot remove or restyle.
- Preview config is held in memory and restored before returning to Companion.
- Android holds the overlay in memory and suppresses WebView state restoration
  while entering, running, or exiting a preview.
- iOS keeps its native chrome until the replacement Companion WebView is
  created, so preview history cannot survive without an exit control.

## Current scope

- Android and iOS.
- One preview session at a time.
- URL-only QR and manual URL entry.
- No downloaded native plugins or build-time configuration changes.
