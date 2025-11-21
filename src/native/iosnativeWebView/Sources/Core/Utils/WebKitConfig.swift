//
//  WebKitConfig.swift
//  CatalystCore
//
//  Lightweight shim that keeps legacy APIs compiling without triggering
//  WKProcessPool deprecation warnings on iOS 15+.
//

import WebKit

public enum WebKitConfig {
    @available(iOS, introduced: 11.0, deprecated: 15.0, message: "Custom WKProcessPool instances have no effect on iOS 15+.")
    public static let sharedProcessPool = WKProcessPool()
    
    private static var legacyPrewarmedWebView: WKWebView?
    
    /// Recreate the legacy shared process pool behavior for iOS versions where it still matters.
    @discardableResult
    public static func prewarmProcessPoolIfNeeded() -> WKWebView? {
        if #available(iOS 15, *) {
            logWithTimestamp("🔥 WebKit process pool prewarm skipped (ignored by iOS 15+)")
            legacyPrewarmedWebView = nil
            return nil
        } else {
            if legacyPrewarmedWebView == nil {
                let configuration = WKWebViewConfiguration()
                configuration.processPool = sharedProcessPool
                legacyPrewarmedWebView = WKWebView(frame: .zero, configuration: configuration)
                logWithTimestamp("🔥 WebKit process pool prewarmed for legacy iOS versions")
            }
            return legacyPrewarmedWebView
        }
    }
    
    /// Apply the shared process pool only on OS versions where Apple still honors it.
    public static func applySharedProcessPoolIfNeeded(to configuration: WKWebViewConfiguration) {
        if #available(iOS 15, *) {
            return
        } else {
            configuration.processPool = sharedProcessPool
        }
    }
}
