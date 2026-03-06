import SwiftUI
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebView")

struct WebView: UIViewRepresentable {
    let urlString: String
    @ObservedObject var viewModel: WebViewModel
    
    init(urlString: String, viewModel: WebViewModel) {
        self.urlString = urlString
        self.viewModel = viewModel
        
        // Register our custom URL protocol
        ResourceURLProtocol.register()
    }
    
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences = preferences
        
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let navigationHandler = WebViewNavigationDelegate(viewModel: viewModel)
        webView.navigationDelegate = navigationHandler
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = true
        
        // Store navigation handler in coordinator
        context.coordinator.navigationHandler = navigationHandler
        
        webView.addObserver(context.coordinator,
                           forKeyPath: #keyPath(WKWebView.estimatedProgress),
                           options: .new,
                           context: nil)
        
        // Initial load
        if let url = URL(string: urlString) {
            let request = URLRequest(url: url)
            webView.load(request)
        }
        
        return webView
    }
    
    func updateUIView(_ webView: WKWebView, context: Context) {
        // Intentionally empty to prevent reloading
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject {
        var parent: WebView
        var navigationHandler: WebViewNavigationDelegate?
        
        init(_ parent: WebView) {
            self.parent = parent
            super.init()
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
    
    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.removeObserver(coordinator, forKeyPath: #keyPath(WKWebView.estimatedProgress))
        ResourceURLProtocol.unregister()
    }
}
