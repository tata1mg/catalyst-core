import SwiftUI
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebView")

struct WebView: UIViewRepresentable {
    let urlString: String
    @StateObject private var viewModel: WebViewModel
    private let navigationDelegate: WebViewNavigationDelegate
    
    init(urlString: String) {
        self.urlString = urlString
        let model = WebViewModel()
        self._viewModel = StateObject(wrappedValue: model)
        self.navigationDelegate = WebViewNavigationDelegate(viewModel: model)
    }
    
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences = preferences
        
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = navigationDelegate
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = true
        
        webView.addObserver(context.coordinator,
                           forKeyPath: #keyPath(WKWebView.estimatedProgress),
                           options: .new,
                           context: nil)
        
        webView.addObserver(context.coordinator,
                           forKeyPath: #keyPath(WKWebView.url),
                           options: .new,
                           context: nil)
        
        let swipeGesture = UISwipeGestureRecognizer(target: context.coordinator,
                                                   action: #selector(Coordinator.handleSwipeGesture(_:)))
        swipeGesture.direction = .right
        webView.addGestureRecognizer(swipeGesture)
        
        logger.info("WebView instance created")
        return webView
    }
    
    func updateUIView(_ webView: WKWebView, context: Context) {
        guard let url = URL(string: urlString),
              viewModel.lastLoadedURL != url else { return }
        
        Task { @MainActor in
            let request = await CacheManager.shared.createCacheableRequest(from: url)
            let hasCachedResponse = await CacheManager.shared.hasCachedResponse(for: request)
            
            viewModel.setLoading(true, fromCache: hasCachedResponse)
            
            if hasCachedResponse {
                logger.info("Loading from cache: \(urlString)")
            } else {
                logger.info("Loading from network: \(urlString)")
            }
            
            webView.load(request)
            viewModel.lastLoadedURL = url
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.removeObserver(coordinator, forKeyPath: #keyPath(WKWebView.estimatedProgress))
        webView.removeObserver(coordinator, forKeyPath: #keyPath(WKWebView.url))
    }
    
    class Coordinator: NSObject {
        var parent: WebView
        
        init(_ parent: WebView) {
            self.parent = parent
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
            } else if keyPath == #keyPath(WKWebView.url),
                      let webView = object as? WKWebView,
                      let url = webView.url {
                logger.info("URL changed to: \(url.absoluteString)")
            }
        }
        
        @objc func handleSwipeGesture(_ gesture: UISwipeGestureRecognizer) {
            if let webView = gesture.view as? WKWebView {
                if webView.canGoBack {
                    webView.goBack()
                    logger.info("👈 Navigating back via swipe gesture")
                }
            }
        }
    }
}
