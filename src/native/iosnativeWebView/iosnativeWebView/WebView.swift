import SwiftUI
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebView")

struct WebView: UIViewRepresentable, Equatable {
    let urlString: String
    @ObservedObject var viewModel: WebViewModel
    private let navigationDelegate: WebViewNavigationDelegate

    // Equatable conformance - only recreate if URL changes
    static func == (lhs: WebView, rhs: WebView) -> Bool {
        return lhs.urlString == rhs.urlString
    }

    init(urlString: String, viewModel: WebViewModel) {
        let start = CFAbsoluteTimeGetCurrent()
        self.urlString = urlString
        self.viewModel = viewModel
        self.navigationDelegate = WebViewNavigationDelegate(viewModel: viewModel)

        // Register our custom URL protocol for caching
        let protocolStart = CFAbsoluteTimeGetCurrent()
        ResourceURLProtocol.register()
        let protocolTime = (CFAbsoluteTimeGetCurrent() - protocolStart) * 1000
        logWithTimestamp("📡 ResourceURLProtocol registered (took \(String(format: "%.2f", protocolTime))ms)")

        let totalTime = (CFAbsoluteTimeGetCurrent() - start) * 1000
        logWithTimestamp("🏗️ WebView init completed (total: \(String(format: "%.2f", totalTime))ms, protocol: \(String(format: "%.2f", protocolTime))ms)")
    }
    
    func makeUIView(context: Context) -> WKWebView {
        let makeUIViewStart = CFAbsoluteTimeGetCurrent()
        logWithTimestamp("🔨 makeUIView() started")

        let configuration = WKWebViewConfiguration()

        // Use shared process pool from AppDelegate for better performance
        configuration.processPool = AppDelegate.sharedProcessPool

        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences = preferences

        let webViewCreateStart = CFAbsoluteTimeGetCurrent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let webViewCreateTime = (CFAbsoluteTimeGetCurrent() - webViewCreateStart) * 1000
        logWithTimestamp("📦 WKWebView created (took \(String(format: "%.2f", webViewCreateTime))ms)")

        webView.navigationDelegate = navigationDelegate
        webView.allowsBackForwardNavigationGestures = true

        // Enable Safari Web Inspector (only available in iOS 16.4+)
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        webView.addObserver(context.coordinator,
                           forKeyPath: #keyPath(WKWebView.estimatedProgress),
                           options: .new,
                           context: nil)
        context.coordinator.isObserverAdded = true

        // Create and register the native bridge
        let bridgeStart = CFAbsoluteTimeGetCurrent()
        context.coordinator.setupNativeBridge(webView)
        let bridgeTime = (CFAbsoluteTimeGetCurrent() - bridgeStart) * 1000
        logWithTimestamp("🌉 NativeBridge setup complete (took \(String(format: "%.2f", bridgeTime))ms)")

        // Initial load
        logWithTimestamp("🎯 About to request navigation to: \(urlString)")
        if let url = URL(string: urlString) {
            let request = URLRequest(url: url)
            logWithTimestamp("🚀 Calling webView.load()")
            let loadStart = CFAbsoluteTimeGetCurrent()
            webView.load(request)
            let loadTime = (CFAbsoluteTimeGetCurrent() - loadStart) * 1000
            logWithTimestamp("✅ webView.load() returned (took \(String(format: "%.2f", loadTime))ms)")
        }

        let makeUIViewTime = (CFAbsoluteTimeGetCurrent() - makeUIViewStart) * 1000
        logWithTimestamp("🔨 makeUIView() completed (took \(String(format: "%.2f", makeUIViewTime))ms)")

        return webView
    }
    
    func updateUIView(_ webView: WKWebView, context: Context) {
        // Intentionally empty to prevent reloading
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // Safely remove observer with error handling
        if coordinator.isObserverAdded {
            do {
                webView.removeObserver(coordinator, forKeyPath: #keyPath(WKWebView.estimatedProgress))
                coordinator.isObserverAdded = false
                logger.debug("Successfully removed WebView progress observer")
            } catch {
                logger.warning("Failed to remove WebView observer - may have already been removed: \(error.localizedDescription)")
            }
        } else {
            logger.debug("Observer was not added or already removed, skipping removal")
        }

        // Clean up native bridge
        coordinator.nativeBridge?.unregister()
        coordinator.nativeBridge = nil
        coordinator.hostingController = nil

        // Unregister custom URL protocol
        ResourceURLProtocol.unregister()

        logger.debug("WebView cleanup completed")
    }
    
    class Coordinator: NSObject {
        var parent: WebView
        var nativeBridge: NativeBridge?
        var hostingController: UIViewController?
        var isObserverAdded = false

        init(_ parent: WebView) {
            self.parent = parent
        }
        
        func setupNativeBridge(_ webView: WKWebView) {
            // Create a UIViewController to use for presenting any UI
            let hostingController = UIViewController()
            self.hostingController = hostingController
            
            // Create and register the native bridge
            let bridge = NativeBridge(webView: webView, viewController: hostingController)
            bridge.register()
            self.nativeBridge = bridge
        }
        
        override func observeValue(forKeyPath keyPath: String?,
                                 of object: Any?,
                                 change: [NSKeyValueChangeKey : Any]?,
                                 context: UnsafeMutableRawPointer?) {
            if keyPath == #keyPath(WKWebView.estimatedProgress),
               let webView = object as? WKWebView {
                Task { @MainActor in
                    parent.viewModel.setProgress(webView.estimatedProgress)
                }
            }
        }
    }
}
