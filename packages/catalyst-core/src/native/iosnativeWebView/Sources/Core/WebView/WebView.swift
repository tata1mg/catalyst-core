import SwiftUI
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebView")

public struct WebView: UIViewRepresentable, Equatable {
    let urlString: String
    @ObservedObject var viewModel: WebViewModel
    let cameraManager: NativeCameraManager
    private let navigationDelegate: WebViewNavigationDelegate

    // Equatable conformance - only recreate if URL changes
    public static func == (lhs: WebView, rhs: WebView) -> Bool {
        return lhs.urlString == rhs.urlString
    }

    public init(urlString: String, viewModel: WebViewModel, cameraManager: NativeCameraManager) {
        let start = CFAbsoluteTimeGetCurrent()
        self.urlString = urlString
        self.viewModel = viewModel
        self.cameraManager = cameraManager
        let initialURL = URL(string: urlString)
        self.navigationDelegate = WebViewNavigationDelegate(viewModel: viewModel, initialURL: initialURL, cameraManager: cameraManager)

        // Register our custom URL protocol for caching
        let protocolStart = CFAbsoluteTimeGetCurrent()
        ResourceURLProtocol.register()
        let protocolTime = (CFAbsoluteTimeGetCurrent() - protocolStart) * 1000
        logWithTimestamp("📡 ResourceURLProtocol registered (took \(String(format: "%.2f", protocolTime))ms)")

        let totalTime = (CFAbsoluteTimeGetCurrent() - start) * 1000
        logWithTimestamp("🏗️ WebView init completed (total: \(String(format: "%.2f", totalTime))ms, protocol: \(String(format: "%.2f", protocolTime))ms)")
    }
    
    public func makeUIView(context: Context) -> WKWebView {
        let makeUIViewStart = CFAbsoluteTimeGetCurrent()
        logWithTimestamp("🔨 makeUIView() started")

        let configuration = WKWebViewConfiguration()

        // Hook kept for legacy behavior; currently a no-op on iOS 15+.
        WebKitConfig.applySharedProcessPoolIfNeeded(to: configuration)

        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences = preferences

        let webViewCreateStart = CFAbsoluteTimeGetCurrent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let webViewCreateTime = (CFAbsoluteTimeGetCurrent() - webViewCreateStart) * 1000
        logWithTimestamp("📦 WKWebView created (took \(String(format: "%.2f", webViewCreateTime))ms)")

        webView.navigationDelegate = navigationDelegate
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear

        // Add our pinch recognizer to route camera zoom when streaming.
        // Web page zoom is disabled via user-scalable=no in the viewport meta tag.
        let pinchGesture = UIPinchGestureRecognizer(target: context.coordinator,
                                                    action: #selector(Coordinator.handleCameraPinch(_:)))
        webView.addGestureRecognizer(pinchGesture)

        #if DEBUG
        // Enable Safari Web Inspector (only available in iOS 16.4+)
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

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

        // Setup safe area handling (calculate insets and cache)
        viewModel.setupSafeAreaHandling()

        // Initial load
        logWithTimestamp("🎯 About to request navigation to: \(urlString)")
        if let url = URL(string: urlString) {
            let status = NetworkMonitor.shared.currentStatus
            if status.isOnline {
                let request = URLRequest(url: url)
                logWithTimestamp("🚀 Calling webView.load()")
                let loadStart = CFAbsoluteTimeGetCurrent()
                webView.load(request)
                let loadTime = (CFAbsoluteTimeGetCurrent() - loadStart) * 1000
                logWithTimestamp("✅ webView.load() returned (took \(String(format: "%.2f", loadTime))ms)")
            } else {
                logWithTimestamp("📴 Device offline on launch, showing offline page")
                _ = navigationDelegate.showOfflinePage(in: webView)
            }
        }

        let makeUIViewTime = (CFAbsoluteTimeGetCurrent() - makeUIViewStart) * 1000
        logWithTimestamp("🔨 makeUIView() completed (took \(String(format: "%.2f", makeUIViewTime))ms)")

        return webView
    }
    
    public func updateUIView(_ webView: WKWebView, context: Context) {
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
    }
    
    public func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    public static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // Safely remove observer with error handling
        if coordinator.isObserverAdded {
            webView.removeObserver(coordinator, forKeyPath: #keyPath(WKWebView.estimatedProgress))
            coordinator.isObserverAdded = false
            logger.debug("Successfully removed WebView progress observer")
        } else {
            logger.debug("Observer was not added or already removed, skipping removal")
        }

        // Clean up native bridge
        coordinator.nativeBridge?.unregister()
        coordinator.nativeBridge = nil
        coordinator.pluginBridge?.unregister()
        coordinator.pluginBridge = nil
        coordinator.hostingController = nil

        // Unregister custom URL protocol
        ResourceURLProtocol.unregister()

        logger.debug("WebView cleanup completed")
    }
    
    public class Coordinator: NSObject {
        var parent: WebView
        var nativeBridge: NativeBridge?
        var pluginBridge: PluginBridge?
        var hostingController: UIViewController?
        var isObserverAdded = false

        public init(_ parent: WebView) {
            self.parent = parent
        }
        
        func setupNativeBridge(_ webView: WKWebView) {
            // Create a UIViewController to use for presenting any UI
            let hostingController = UIViewController()
            self.hostingController = hostingController

            // Create and register the native bridge
            let bridge = NativeBridge(webView: webView, viewController: hostingController, cameraManager: parent.cameraManager)
            let pluginBridge = PluginBridge(webView: webView, viewController: hostingController)

            // Inject WebViewModel for safe area handling
            Task { @MainActor in
                bridge.setWebViewModel(parent.viewModel)
            }

            // Inject notification handler from global provider
            bridge.setNotificationHandler(NotificationHandlerProvider.shared)

            bridge.register()
            pluginBridge.register()
            self.nativeBridge = bridge
            self.pluginBridge = pluginBridge
        }
        
        @objc func handleCameraPinch(_ gesture: UIPinchGestureRecognizer) {
            // No-op when camera is not streaming — don't accidentally zoom the page
            guard parent.cameraManager.isStreaming else { return }
            switch gesture.state {
            case .began:
                parent.cameraManager.handlePinchBegan()
            case .changed:
                parent.cameraManager.handlePinchChanged(scale: gesture.scale)
            default:
                break
            }
        }

        override public func observeValue(forKeyPath keyPath: String?,
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

        deinit {
            // Ensure observer is removed even if dismantleUIView is skipped.
            if isObserverAdded, let webView = nativeBridge?.webView {
                webView.removeObserver(self, forKeyPath: #keyPath(WKWebView.estimatedProgress))
            }
        }
    }
}
