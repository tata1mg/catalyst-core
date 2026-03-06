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
        logger.info("🏗️ [\(ThreadHelper.currentThreadInfo())] Navigation delegate initialized")
    }
    
    func webView(_ webView: WKWebView,
                decidePolicyFor navigationAction: WKNavigationAction,
                decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        
        guard let url = navigationAction.request.url else {
            logger.info("⚠️ [\(ThreadHelper.currentThreadInfo())] No URL in navigation action")
            decisionHandler(.allow)
            return
        }
        logger.info("🌐 Navigation requested to: \(url.absoluteString)")

        Task {
            if CacheManager.shared.shouldCacheURL(url) {
                logger.info("🎯 URL matches cache pattern: \(url.absoluteString)")

                let (cachedData, cacheState, mimeType) = await CacheManager.shared.getCachedResource(
                    for: navigationAction.request
                )
                
                switch cacheState {
                case .fresh, .stale:
                    logger.info("✅ Serving fresh/stale cached content")

                    if let cachedData = cachedData,
                       let mimeType = mimeType {
                        logger.info("📤 Loading cached data with MIME type: \(mimeType)")
                        await MainActor.run {
                            viewModel.setLoading(true, fromCache: true)
                            webView.load(cachedData,
                                       mimeType: mimeType,
                                       characterEncodingName: "UTF-8",
                                       baseURL: url)
                        }
                        
                        decisionHandler(.cancel)
                        return
                    }
                    
                case .expired:
                    logger.info("♻️ Cache expired, fetching fresh content")
                    break
                }
            } else {
                logger.info("⏭️ URL doesn't match cache pattern: \(url.absoluteString)")
            }
        }
    }
    
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        logger.info("▶️ [\(ThreadHelper.currentThreadInfo())] Started provisional navigation")
        Task { @MainActor in
            viewModel.setLoading(true, fromCache: false)
        }
    }
    
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        logger.info("✳️ [\(ThreadHelper.currentThreadInfo())] Navigation committed")
        Task { @MainActor in
            if let url = webView.url {
                viewModel.setLastLoadedURL(url)
            }
        }
    }
    
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        logger.info("✅ [\(ThreadHelper.currentThreadInfo())] Navigation finished")
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
        logger.error("❌ [\(ThreadHelper.currentThreadInfo())] Navigation failed: \(error.localizedDescription)")
        handleNavigationError(error)
    }
    
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        logger.error("❌ [\(ThreadHelper.currentThreadInfo())] Provisional navigation failed: \(error.localizedDescription)")
        handleNavigationError(error)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        
        guard let response = navigationResponse.response as? HTTPURLResponse,
              let url = response.url else {
            logger.info("⚠️ [\(ThreadHelper.currentThreadInfo())] No valid response for policy decision")
            decisionHandler(.allow)
            return
        }
        
        logger.info("📥 [\(ThreadHelper.currentThreadInfo())] Received navigation response for: \(url.absoluteString)")
        
        Task {
            if CacheManager.shared.shouldCacheURL(url) {
                let request = URLRequest(url: url)
                
                URLSession.shared.dataTask(with: request) { data, urlResponse, error in
                    if let data = data,
                       let httpResponse = urlResponse as? HTTPURLResponse {
                        Task {
                            CacheManager.shared.storeCachedResponse(
                                httpResponse,
                                data: data,
                                for: request
                            )
                        }
                    } else if let error = error {
                        logger.error("❌ [\(ThreadHelper.currentThreadInfo())] Cache storage failed: \(error.localizedDescription)")
                    }
                }.resume()
            } else {
                logger.info("⏭️ [\(ThreadHelper.currentThreadInfo())] URL not eligible for caching")
            }
            
            await MainActor.run {
                logger.info("✅ [\(ThreadHelper.currentThreadInfo())] Allowing navigation response")
                decisionHandler(.allow)
            }
        }
    }
    
    private func handleNavigationError(_ error: Error) {
        Task { @MainActor in
            logger.error("💥 [\(ThreadHelper.currentThreadInfo())] Handling navigation error: \(error.localizedDescription)")
            viewModel.setError(error)
            viewModel.reset()
        }
    }
}
