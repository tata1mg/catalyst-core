//
//  PluginBridgeOriginPolicy.swift
//
//  Decides whether a message to the plugin bridge came from the app's own page.
//  Plugins run native code (on-device AI, device info, ...), so only the page the app loaded may drive them:
//  not a subframe, and not a page the WebView was later navigated to (an external link, an ad iframe).
//

import Foundation

public enum PluginBridgeOriginPolicy {

    /// "scheme://host:port" with the scheme and host lowercased and the default port made explicit, so
    /// "https://App.example.com" and "https://app.example.com:443" compare equal. Nil for anything that is
    /// not an http(s) URL with a host.
    public static func normalizedOrigin(of url: URL?) -> String? {
        guard let url,
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host?.lowercased(), !host.isEmpty else {
            return nil
        }
        let port = url.port ?? (scheme == "https" ? 443 : 80)
        return "\(scheme)://\(host):\(port)"
    }

    /// True only for a main-frame message whose origin equals the trusted (app) origin. Fails closed: no trusted
    /// origin, no source origin, a subframe, or a different origin all return false.
    public static func isAllowed(isMainFrame: Bool, sourceURL: URL?, trustedURL: URL?) -> Bool {
        guard isMainFrame,
              let trusted = normalizedOrigin(of: trustedURL),
              let source = normalizedOrigin(of: sourceURL) else {
            return false
        }
        return source == trusted
    }
}
