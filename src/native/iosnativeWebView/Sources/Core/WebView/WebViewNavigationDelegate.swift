import WebKit
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
        
        guard let url = navigationAction.request.url else {
            logger.info("⚠️ No URL in navigation action")
            decisionHandler(.allow)
            return
        }
        logWithTimestamp("🌐 Navigation requested to: \(url.absoluteString)")

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
                    }
                }.resume()
            }
            
            await MainActor.run {
                decisionHandler(.allow)
            }
        }
    }
    
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        logWithTimestamp("📡 didStartProvisionalNavigation - loading started")
        Task { @MainActor in
            viewModel.setLoading(true, fromCache: false)
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        logWithTimestamp("✅ didCommit - content started arriving")
        Task { @MainActor in
            if let url = webView.url {
                viewModel.lastLoadedURL = url
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        logWithTimestamp("🎉 didFinish - page fully loaded")
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
        logWithTimestamp("❌ didFail - navigation failed")
        handleNavigationError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        logWithTimestamp("❌ didFailProvisionalNavigation - provisional load failed")
        handleNavigationError(error)
    }

    private func handleNavigationError(_ error: Error) {
        Task { @MainActor in
            viewModel.reset()
            logWithTimestamp("🔴 Navigation error: \(error.localizedDescription)")
            logger.error("Navigation failed: \(error.localizedDescription)")
        }
    }
}
