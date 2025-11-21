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

        let httpMethod = navigationAction.request.httpMethod?.uppercased() ?? "GET"
        let hasBody = navigationAction.request.httpBody != nil || navigationAction.request.httpBodyStream != nil
        let bodySize = navigationAction.request.httpBody?.count ?? 0
        let bodyPreview = navigationAction.request.httpBody != nil ? String(data: navigationAction.request.httpBody!, encoding: .utf8) ?? "<binary>" : "<none>"

        logWithTimestamp("🌐 Navigation requested: \(httpMethod) \(url.absoluteString)")
        logger.info("📦 Request details - Method: \(httpMethod), HasBody: \(hasBody), BodySize: \(bodySize) bytes")
        if bodySize > 0 && bodySize < 1000 {
            logger.info("📄 Body preview: \(bodyPreview)")
        }

        // Handle special URL schemes (tel:, mailto:, sms:)
        if handleSpecialScheme(url) {
            decisionHandler(.cancel)
            return
        }

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
            // Only cache GET requests - skip caching for POST/PUT/PATCH/DELETE
            let isCacheableMethod = httpMethod == "GET"
            logger.info("🔍 Cache check - Method: \(httpMethod), isCacheable: \(isCacheableMethod)")

            if isCacheableMethod && CacheManager.shared.shouldCacheURL(url) {
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
                if !isCacheableMethod {
                    logger.info("⏭️ Skipping cache for non-GET request (\(httpMethod)): \(url.absoluteString)")
                } else {
                    logger.info("⏭️ URL doesn't match cache pattern: \(url.absoluteString)")
                }
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
    
    /// Handle SSL certificate challenges
    /// For localhost connections, trust our self-signed certificate
    /// For all other domains, use default validation
    func webView(_ webView: WKWebView,
                didReceive challenge: URLAuthenticationChallenge,
                completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        
        let protectionSpace = challenge.protectionSpace
        let host = protectionSpace.host
        
        // Only bypass certificate validation for localhost
        if (host == "localhost" || host == "127.0.0.1") &&
            protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            
            logger.debug("🔐 SSL challenge for localhost - trusting self-signed certificate")
            
            if let serverTrust = protectionSpace.serverTrust {
                let credential = URLCredential(trust: serverTrust)
                completionHandler(.useCredential, credential)
                logger.info("✅ Trusted self-signed certificate for localhost")
                return
            }
        }
        
        // For all other domains, use default certificate validation
        logger.debug("🔐 SSL challenge for \(host) - using default validation")
        completionHandler(.performDefaultHandling, nil)
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
    
    /// Handle special URL schemes (tel:, mailto:, sms:)
    private func handleSpecialScheme(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        
        // Only handle tel, mailto, sms
        guard ["tel", "mailto", "sms"].contains(scheme) else { return false }
        
        Task { @MainActor in
            if UIApplication.shared.canOpenURL(url) {
                // App available to handle the scheme (opens default mail app for mailto)
                UIApplication.shared.open(url, options: [:])
            } else {
                // Fallback for mailto: open Gmail web in browser
                if scheme == "mailto" {
                    if let gmailWebURL = URL(string: "https://mail.google.com") {
                        openInSystemBrowser(gmailWebURL)
                    }
                }
            }
        }
        
        return true
    }
}
