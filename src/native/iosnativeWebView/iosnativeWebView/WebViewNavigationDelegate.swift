@preconcurrency import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewNavigation")

class WebViewNavigationDelegate: NSObject, WKNavigationDelegate {
    private var viewModel: WebViewModel
    private var currentNavigation: WKNavigation?
    
    init(viewModel: WebViewModel) {
        self.viewModel = viewModel
        super.init()
    }
    
    func webView(_ webView: WKWebView,
                decidePolicyFor navigationAction: WKNavigationAction,
                decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url {
            let urlString = url.absoluteString
            
            Task {
                do {
                    // Check if we have this in cache
                    let request = await CacheManager.shared.createCacheableRequest(from: url)
                    let hasCachedResponse = await CacheManager.shared.hasCachedResponse(for: request)
                    
                    logger.info("🔄 Navigation request to: \(urlString)")
                    logger.info("👆 Navigation type: \(self.navigationTypeString(navigationAction.navigationType))")
                    logger.info("💾 Cache status: \(hasCachedResponse ? "Hit" : "Miss")")
                    
                    // For client-side navigation (usually type .other), ensure content is cached
                    if navigationAction.navigationType == .other {
                        if !hasCachedResponse {
                            logger.info("📥 Fetching and caching client-side route: \(urlString)")
                            let data = try await CacheManager.shared.loadURL(url)
                            if let response = HTTPURLResponse(url: url,
                                                           statusCode: 200,
                                                           httpVersion: "1.1",
                                                           headerFields: nil) {
                                await CacheManager.shared.storeCachedResponse(response, data: data, for: request)
                            }
                        } else {
                            logger.info("📤 Loading client-side route from cache: \(urlString)")
                        }
                    }
                    
                    await MainActor.run {
                        viewModel.setLoading(true, fromCache: hasCachedResponse)
                    }
                    
                } catch {
                    logger.error("❌ Error handling navigation: \(error.localizedDescription)")
                }
            }
            
            // Log navigation source
            switch navigationAction.navigationType {
            case .linkActivated:
                logger.info("📎 Link click navigation")
            case .formSubmitted:
                logger.info("📝 Form submission")
            case .backForward:
                logger.info("⬅️ Back/Forward navigation")
            case .reload:
                logger.info("🔄 Page reload")
            case .formResubmitted:
                logger.info("📋 Form resubmission")
            case .other:
                logger.info("🛣️ Client-side routing navigation")
            @unknown default:
                logger.info("❓ Unknown navigation type")
            }
        }
        decisionHandler(.allow)
    }
    
    func webView(_ webView: WKWebView,
                decidePolicyFor navigationResponse: WKNavigationResponse,
                decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let response = navigationResponse.response as? HTTPURLResponse,
           let url = navigationResponse.response.url {
            
            let urlString = url.absoluteString
            logger.info("📥 Response received for: \(urlString)")
            logger.info("🏷️ Response type: \(navigationResponse.response.mimeType ?? "unknown")")
            logger.info("📊 Status code: \(response.statusCode)")
            
            Task {
                do {
                    // Create cacheable request
                    let request = await CacheManager.shared.createCacheableRequest(from: url)
                    
                    // Check if already cached
                    let hasCachedResponse = await CacheManager.shared.hasCachedResponse(for: request)
                    
                    if !hasCachedResponse {
                        // Load and cache the response
                        let data = try await CacheManager.shared.loadURL(url)
                        await CacheManager.shared.storeCachedResponse(response, data: data, for: request)
                        logger.info("💾 Cached new response for: \(urlString)")
                    } else {
                        logger.info("✅ Response already in cache for: \(urlString)")
                    }
                    
                    // Log cache statistics
                    let stats = await CacheManager.shared.getCacheStatistics()
                    logger.info("📊 Cache stats - Memory: \(stats.memoryUsed/1024)KB, Disk: \(stats.diskUsed/1024)KB")
                    
                } catch {
                    logger.error("❌ Failed to cache response: \(error.localizedDescription)")
                }
            }
        }
        decisionHandler(.allow)
    }
    
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        currentNavigation = navigation
        if let url = webView.url {
            logger.info("🏁 Started loading: \(url.absoluteString)")
        }
    }
    
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        if let url = webView.url {
            logger.info("✅ Navigation committed for: \(url.absoluteString)")
            // Track this URL for caching
            Task { @MainActor in
                viewModel.lastLoadedURL = url
            }
        }
    }
    
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let url = webView.url {
            logger.info("🏆 Finished loading: \(url.absoluteString)")
            Task { @MainActor in
                viewModel.setLoading(false)
                viewModel.canGoBack = webView.canGoBack
                viewModel.addToHistory(url.absoluteString)
                
                // Ensure the current URL is cached
                let request = await CacheManager.shared.createCacheableRequest(from: url)
                if let response = HTTPURLResponse(url: url,
                                               statusCode: 200,
                                               httpVersion: "1.1",
                                               headerFields: nil) {
                    do {
                        let data = try await CacheManager.shared.loadURL(url)
                        await CacheManager.shared.storeCachedResponse(response, data: data, for: request)
                        logger.info("💾 Ensured current route is cached: \(url.absoluteString)")
                    } catch {
                        logger.error("❌ Failed to cache current route: \(error.localizedDescription)")
                    }
                }
            }
        }
    }
    
    func webView(_ webView: WKWebView,
                didFail navigation: WKNavigation!,
                withError error: Error) {
        handleNavigationError(error)
    }
    
    func webView(_ webView: WKWebView,
                didFailProvisionalNavigation navigation: WKNavigation!,
                withError error: Error) {
        handleNavigationError(error)
    }
    
    private func handleNavigationError(_ error: Error) {
        Task { @MainActor in
            viewModel.reset()
            logger.error("❌ Navigation failed: \(error.localizedDescription)")
        }
    }
    
    private func navigationTypeString(_ type: WKNavigationType) -> String {
        switch type {
        case .linkActivated: return "Link Activated"
        case .formSubmitted: return "Form Submitted"
        case .backForward: return "Back/Forward"
        case .reload: return "Reload"
        case .formResubmitted: return "Form Resubmitted"
        case .other: return "Client-side Navigation"
        @unknown default: return "Unknown"
        }
    }
}
