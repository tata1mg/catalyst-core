# NATIVE-010

**Category:** NATIVE

## Message

Invalid app id

## Details

The app id (WEBVIEW_CONFIG.appId, android.packageName or ios.bundleIdentifier / appBundleId) is not a valid id for the platform. Android needs a Java package name: two or more dot-separated parts, each starting with a letter and using only letters, digits and _, none a Java keyword. iOS needs two or more parts of letters, digits and -.

## Suggested action

Set WEBVIEW_CONFIG.appId in config/config.json to a reverse-DNS id such as com.acme.shop: letters and digits only, each part starting with a letter.
