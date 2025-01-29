import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewNavigation")

@MainActor
class WebViewNavigationDelegate: NSObject, WKNavigationDelegate {
    private let viewModel: WebViewModel
    private let resourceManager: WebResourceManager
    
    init(viewModel: WebViewModel, resourceManager: WebResourceManager = .shared) {
        self.viewModel = viewModel
        self.resourceManager = resourceManager
        super.init()
    }
    
    func webView(_ webView: WKWebView,
                decidePolicyFor navigationAction: WKNavigationAction,
                decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        
        guard let url = navigationAction.request.url else {
            logger.info("⚠️ No URL in navigation action")
            decisionHandler(.allow)
            return
        }
        
        logger.info("🌐 Navigation requested to: \(url.absoluteString)")
        
        Task {
            do {
                if await CacheManager.shared.shouldCacheURL(url) {
                    logger.info("🎯 URL matches cache pattern: \(url.absoluteString)")
                    
                    // Update UI state immediately
                    await viewModel.setLoading(true, fromCache: false)
                    
                    // Load resource asynchronously
                    let (data, mimeType) = try await resourceManager.loadResource(url: url)
                    
                    // Handle successful load on main thread
                    if let mimeType = mimeType {
                        logger.info("📤 Loading cached data with MIME type: \(mimeType)")
                        await viewModel.setLoading(true, fromCache: true)
                        
                        webView.load(data,
                                   mimeType: mimeType,
                                   characterEncodingName: "UTF-8",
                                   baseURL: url)
                        
                        decisionHandler(.cancel)
                        return
                    }
                } else {
                    logger.info("⏭️ URL doesn't match cache pattern: \(url.absoluteString)")
                }
                
                // Default behavior for non-cached content
                await viewModel.setLoading(true, fromCache: false)
                decisionHandler(.allow)
                
            } catch {
                logger.error("❌ Resource loading failed: \(error.localizedDescription)")
                // Handle errors on main thread
                await viewModel.setError(error)
                await viewModel.setLoading(false, fromCache: false)
                decisionHandler(.allow) // Fallback to normal loading
            }
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
        
        Task {
            if await CacheManager.shared.shouldCacheURL(url) {
                let request = URLRequest(url: url)
                
                // Get response data for caching
                URLSession.shared.dataTask(with: request) { [weak self] data, urlResponse, error in
                    if let data = data,
                       let httpResponse = urlResponse as? HTTPURLResponse {
                        Task {
                            await CacheManager.shared.storeCachedResponse(
                                httpResponse,
                                data: data,
                                for: request
                            )
                        }
                    }
                }.resume()
            }
            
            decisionHandler(.allow)
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
                viewModel.setLastLoadedURL(url)
            }
        }
    }
    
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            if let url = webView.url {
                viewModel.setLastLoadedURL(url)
                viewModel.setCanGoBack(webView.canGoBack)
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
            viewModel.setError(error)
            viewModel.reset()
            logger.error("Navigation failed: \(error.localizedDescription)")
        }
    }
}
