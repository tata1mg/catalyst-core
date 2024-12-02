import SwiftUI
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebView")

struct WebView: UIViewRepresentable {
    let urlString: String
    @ObservedObject var viewModel: WebViewModel
    private let navigationDelegate: WebViewNavigationDelegate
    
    init(urlString: String, viewModel: WebViewModel) {
        self.urlString = urlString
        self.viewModel = viewModel
        self.navigationDelegate = WebViewNavigationDelegate(viewModel: viewModel)
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
    
    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.removeObserver(coordinator, forKeyPath: #keyPath(WKWebView.estimatedProgress))
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
            }
        }
    }
}
