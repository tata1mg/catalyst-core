@preconcurrency import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewNavigation")

class WebViewNavigationDelegate: NSObject, WKNavigationDelegate {
    private var viewModel: WebViewModel
    
    init(viewModel: WebViewModel) {
        self.viewModel = viewModel
        super.init()
    }
    
    func webView(_ webView: WKWebView,
                decidePolicyFor navigationAction: WKNavigationAction,
                decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
//        // Always allow navigation
//        decisionHandler(.allow)
        
//        if let url = navigationAction.request.url {
//            Task { @MainActor in
//                viewModel.setLoading(true, fromCache: false)
//            }
//        }
        
        guard let url = navigationAction.request.url else {
                    decisionHandler(.allow)
                    return
                }
        
        Task {
                    if await CacheManager.shared.shouldCacheURL(url) {
                        // Check if we have it cached
                        if await CacheManager.shared.hasCachedResponse(for: navigationAction.request) {
                            if let cachedData = await CacheManager.shared.getCachedData(for: navigationAction.request) {
                                await MainActor.run {
                                    viewModel.setLoading(true, fromCache: true)
                                }
                                
                                // Load cached data
                                webView.load(cachedData, mimeType: "application/octet-stream",
                                           characterEncodingName: "UTF-8",
                                           baseURL: url)
                                
                                decisionHandler(.cancel)
                                return
                            }
                        }
                    }
                    
                    // If not cached or shouldn't be cached, proceed normally
                    await MainActor.run {
                        viewModel.setLoading(true, fromCache: false)
                    }
                    decisionHandler(.allow)
                }
        
    }
    
    func webView(_ webView: WKWebView,
                     decidePolicyFor navigationResponse: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            
            guard let response = navigationResponse.response as? HTTPURLResponse,
                  let url = response.url else {
                decisionHandler(.allow)
                return
            }
            
            // Create the request
            let request = URLRequest(url: url)
            
            Task {
                // Check pattern match in async context
                if await CacheManager.shared.shouldCacheURL(url) {
                    // Create a URLSession data task to get the response data
                    URLSession.shared.dataTask(with: request) { [weak self] data, urlResponse, error in
                        if let data = data,
                           let httpResponse = urlResponse as? HTTPURLResponse {
                            Task {
                                // Store in cache in async context
                                await CacheManager.shared.storeCachedResponse(httpResponse,
                                                                            data: data,
                                                                            for: request)
                            }
                        }
                    }.resume()
                }
                
                // Execute decision handler on main thread
                await MainActor.run {
                    decisionHandler(.allow)
                }
            }
        }
    
    
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        Task { @MainActor in
            viewModel.setLoading(true, fromCache: false)
        }
    }
    
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        Task { @MainActor in
            if let url = webView.url {
                viewModel.lastLoadedURL = url
            }
        }
    }
    
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            if let url = webView.url {
                viewModel.lastLoadedURL = url
                viewModel.canGoBack = webView.canGoBack
                viewModel.addToHistory(url.absoluteString)
                viewModel.setLoading(false, fromCache: false)
            }
        }
    }
    
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleNavigationError(error)
    }
    
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleNavigationError(error)
    }
    
    private func handleNavigationError(_ error: Error) {
        Task { @MainActor in
            viewModel.reset()
            logger.error("Navigation failed: \(error.localizedDescription)")
        }
    }
}
