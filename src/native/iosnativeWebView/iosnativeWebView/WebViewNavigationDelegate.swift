import WebKit
import os
import UIKit

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
        logger.info("🌐 Navigation requested to: \(url.absoluteString)")

        if URLWhitelistManager.shared.isAccessControlEnabled {
            
            // Check if URL is an external domain
            let isExternal = URLWhitelistManager.shared.isExternalDomain(url)            
            if ["http", "https"].contains(url.scheme?.lowercased() ?? "") && isExternal {
                logger.info("🌍 External domain detected, opening in system browser: \(url.absoluteString)")
                openInSystemBrowser(url)
                decisionHandler(.cancel)
                return
            }
            
            // Check if URL is allowed for internal navigation
            let isAllowed = URLWhitelistManager.shared.isUrlAllowed(url)
            
            if !isAllowed {
                logger.warning("🚫 URL blocked by access control: \(url.absoluteString)")
                decisionHandler(.cancel)
                return
            }
            
            logger.info("✅ URL passed whitelist checks, allowing navigation: \(url.absoluteString)")
        } else {
            logger.info("⚠️ Access control disabled, allowing all navigation: \(url.absoluteString)")
        }

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
    
    /// Open URL in system browser
    private func openInSystemBrowser(_ url: URL) {
        Task { @MainActor in
            if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url, options: [:]) { success in
                    if success {
                        logger.info("Successfully opened external URL in system browser")
                    } else {
                        logger.error("Failed to open external URL in system browser")
                    }
                }
            } else {
                logger.error("Cannot open URL in system browser: \(url.absoluteString)")
            }
        }
    }
}
