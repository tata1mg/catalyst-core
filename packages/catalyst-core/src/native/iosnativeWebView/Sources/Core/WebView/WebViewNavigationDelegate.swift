import WebKit
import os
import UIKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewNavigation")

class WebViewNavigationDelegate: NSObject, WKNavigationDelegate {
    private var viewModel: WebViewModel
    private let offlineFileName = "offline.html"
    private let offlineSubdirectory = "offline"
    private var offlinePageVisible = false
    private var offlineSnapshotVisibleURL: String?
    private var lastTargetURL: URL?
    private let initialURL: URL?
    private weak var cameraManager: NativeCameraManager?
    private var pageLoadStartMs: Int64?
    private var didEmitColdStart = false

    init(viewModel: WebViewModel, initialURL: URL?, cameraManager: NativeCameraManager? = nil) {
        self.viewModel = viewModel
        self.initialURL = initialURL
        self.lastTargetURL = initialURL
        self.cameraManager = cameraManager
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

        // Inject safe area headers for main frame HTTP/HTTPS requests
        // Only inject on main frame to match Android behavior (not on subresources)
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? false
        let isHttpScheme = ["http", "https"].contains(url.scheme?.lowercased() ?? "")
        let isCatalystOfflineURL = OfflineCacheService.shared.originalURL(forOfflineURL: url) != nil

        if isMainFrame && isHttpScheme && httpMethod == "GET" {
            let safeAreaHeaders = viewModel.getSafeAreaHeaders()

            // Check if headers are already present (avoid re-injecting)
            let currentHeaders = navigationAction.request.allHTTPHeaderFields ?? [:]
            let hasExistingHeaders = currentHeaders.keys.contains("X-Safe-Area-Top")

            if !hasExistingHeaders && !safeAreaHeaders.isEmpty {
                logger.info("📋 Injecting safe area headers for main frame: \(url.absoluteString)")
                #if DEBUG
                logger.debug("📋 Headers: \(safeAreaHeaders)")
                #endif

                // Create new request with safe area headers
                var newRequest = navigationAction.request
                var allHeaders = currentHeaders
                allHeaders.merge(safeAreaHeaders) { (_, new) in new }
                newRequest.allHTTPHeaderFields = allHeaders

                // Cancel current navigation and reload with headers
                decisionHandler(.cancel)
                webView.load(newRequest)
                return
            }
        }

        // Handle offline retry scheme before any other processing
        if isRetryURL(url) {
            handleRetry(in: webView)
            decisionHandler(.cancel)
            return
        }

        // Handle special URL schemes (tel:, mailto:, sms:)
        if handleSpecialScheme(url) {
            decisionHandler(.cancel)
            return
        }

        if URLWhitelistManager.shared.isAccessControlEnabled && !isCatalystOfflineURL {

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
        } else if !isCatalystOfflineURL {
            logger.info("⚠️ Access control disabled, allowing all navigation: \(url.absoluteString)")
        } else {
            logger.info("📴 Catalyst offline URL allowed: \(url.absoluteString)")
        }

        if ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            lastTargetURL = url
        }

        Task {
            // Only cache GET requests - skip caching for POST/PUT/PATCH/DELETE
            let isCacheableMethod = httpMethod == "GET"
            logger.info("🔍 Cache check - Method: \(httpMethod), isCacheable: \(isCacheableMethod)")

            if isMainFrame && isHttpScheme && isCacheableMethod {
                if NetworkMonitor.shared.currentStatus.isOnline {
                    let isOfflineRoute = await OfflineCacheService.shared.prepareActiveOfflineRoute(
                        for: navigationAction.request,
                        webView: webView
                    )
                    offlineSnapshotVisibleURL = nil
                    if !isOfflineRoute {
                        logger.info("⏭️ Main-frame route is not currently offline eligible: \(url.absoluteString)")
                    }
                    OfflineCacheService.shared.storeRouteSnapshot(
                        for: navigationAction.request,
                        webView: webView
                    )
                } else {
                    let loadedSnapshot = await MainActor.run {
                        loadCachedSnapshotIfNeeded(in: webView, for: url)
                    }

                    if loadedSnapshot {
                        logger.info("📴 Serving cached offline route snapshot: \(url.absoluteString)")
                        decisionHandler(.cancel)
                        return
                    }
                    OfflineCacheService.shared.clearActiveOfflineRoute()
                }
            } else if isMainFrame && isHttpScheme {
                OfflineCacheService.shared.clearActiveOfflineRoute()
            }

            if isCacheableMethod && CacheManager.shared.shouldCacheURL(url) {
            logger.info("🎯 URL matches cache pattern: \(url.absoluteString)")

                let cacheStartMs = CatalystPerf.nativeTimeMs()
                let (cachedData, cacheState, mimeType) = await CacheManager.shared.getCachedResource(
                    for: navigationAction.request
                )
                let cacheDurationMs = CatalystPerf.nativeTimeMs() - cacheStartMs
                
                switch cacheState {
                case .fresh, .stale:
                    logger.info("✅ Serving fresh/stale cached content")
                    CatalystPerf.add([
                        "type": "cache-hit-memory",
                        "url": url.absoluteString,
                        "resourceType": "document",
                        "nativeTime": cacheStartMs,
                        "nativeStartMs": cacheStartMs,
                        "durationMs": cacheDurationMs,
                        "source": cacheState == .fresh ? "fresh" : "stale",
                    ])

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
                    CatalystPerf.add([
                        "type": "cache-miss-fetch",
                        "url": url.absoluteString,
                        "resourceType": "document",
                        "nativeTime": cacheStartMs,
                        "nativeStartMs": cacheStartMs,
                        "durationMs": cacheDurationMs,
                    ])
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
        let nativeNow = CatalystPerf.nativeTimeMs()
        pageLoadStartMs = nativeNow
        CatalystPerf.injectNativeTimeOffset(into: webView)
        if let url = webView.url?.absoluteString ?? lastTargetURL?.absoluteString {
            CatalystPerf.add([
                "type": "boot-page-started",
                "nativeTime": nativeNow,
                "url": url,
            ])
            CatalystPerf.add([
                "type": "page-load-start",
                "nativeTime": nativeNow,
                "url": url,
            ])
        }
        // Stop camera on navigation — mirrors Android CustomWebview onPageStarted lambda
        cameraManager?.stop()
        Task { @MainActor in
            if !isOfflinePageURL(webView.url) {
                offlinePageVisible = false
            }
            viewModel.setLoading(true, fromCache: false)
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        logWithTimestamp("✅ didCommit - content started arriving")
        Task { @MainActor in
            if let url = webView.url {
                if !isOfflinePageURL(url) {
                    viewModel.lastLoadedURL = url
                    lastTargetURL = url
                } else {
                    offlinePageVisible = true
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        logWithTimestamp("🎉 didFinish - page fully loaded")
        let nativeNow = CatalystPerf.nativeTimeMs()
        let url = webView.url?.absoluteString ?? lastTargetURL?.absoluteString ?? ""
        let durationMs = pageLoadStartMs.map { nativeNow - $0 } ?? 0
        CatalystPerf.add([
            "type": "boot-page-finished",
            "nativeTime": nativeNow,
            "url": url,
        ])
        CatalystPerf.add([
            "type": "page-load-end",
            "nativeTime": nativeNow,
            "url": url,
            "durationMs": durationMs,
        ])
        if !didEmitColdStart {
            didEmitColdStart = true
            CatalystPerf.add([
                "type": "cold-start",
                "nativeTime": nativeNow,
                "url": url,
                "durationMs": nativeNow - AppBoot.nativeStartMs,
            ])
        }
        CatalystPerf.memorySnapshot(to: nil, label: "page-finish")
        CatalystPerf.scheduleFlush(webView)

        Task { @MainActor in
            if let url = webView.url {
                if !isOfflinePageURL(url) {
                    viewModel.lastLoadedURL = url
                    lastTargetURL = url
                    viewModel.addToHistory(url.absoluteString)
                } else {
                    offlinePageVisible = true
                }
                viewModel.canGoBack = webView.canGoBack
                viewModel.setLoading(false, fromCache: false)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        logWithTimestamp("❌ didFail - navigation failed")
        handleNavigationError(error, webView: webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        logWithTimestamp("❌ didFailProvisionalNavigation - provisional load failed")
        handleNavigationError(error, webView: webView)
    }

    private func handleNavigationError(_ error: Error, webView: WKWebView?) {
        CatalystPerf.emit([
            "type": "page-load-error",
            "nativeTime": CatalystPerf.nativeTimeMs(),
            "url": webView?.url?.absoluteString ?? lastTargetURL?.absoluteString ?? "",
            "description": error.localizedDescription,
        ], to: webView)

        Task { @MainActor in
            viewModel.reset()
            logWithTimestamp("🔴 Navigation error: \(error.localizedDescription)")
            logger.error("Navigation failed: \(error.localizedDescription)")

            guard shouldShowOfflinePage(for: error), let webView else { return }
            if let targetURL = lastTargetURL ?? webView.url,
               isOfflineSnapshotVisible(for: targetURL) {
                logger.info("📴 Ignoring repeated error for visible offline route snapshot")
                return
            }

            if let targetURL = lastTargetURL ?? webView.url,
               loadCachedSnapshotIfNeeded(in: webView, for: targetURL) {
                logger.info("📴 Showing cached offline route snapshot")
                return
            }

            if showOfflinePage(in: webView) {
                logger.info("📴 Showing offline fallback page")
            } else {
                logger.error("❌ Unable to show offline page - file missing in bundle")
            }
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

    private func isRetryURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme != "catalyst" { return false }

        let host = url.host?.lowercased()
        let pathComponent = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        return host == "retry" || pathComponent == "retry" || url.absoluteString.lowercased() == "catalyst://retry"
    }

    private func handleRetry(in webView: WKWebView) {
        let status = NetworkMonitor.shared.currentStatus

        guard status.isOnline else {
            logger.info("🔄 Retry requested but still offline; staying on offline page")
            return
        }

        let targetURL = lastTargetURL ?? initialURL
        guard let targetURL else {
            logger.error("🔄 Retry requested but no target URL is known")
            return
        }

        offlinePageVisible = false
        offlineSnapshotVisibleURL = nil
        OfflineCacheService.shared.clearActiveOfflineRoute()
        logWithTimestamp("🔄 Retry requested, online. Reloading: \(targetURL.absoluteString)")
        webView.load(URLRequest(url: targetURL))
    }

    private func isOfflinePageURL(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.lastPathComponent.lowercased() == offlineFileName.lowercased()
    }

    private func shouldShowOfflinePage(for error: Error) -> Bool {
        // Only show offline fallback when we truly have no connectivity
        if !NetworkMonitor.shared.currentStatus.isOnline {
            return true
        }

        // Treat explicit no-internet errors as offline; allow other errors to surface in the WebView
        guard let urlError = error as? URLError else { return false }
        return urlError.code == .notConnectedToInternet || urlError.code == .networkConnectionLost
    }

    func showOfflinePage(in webView: WKWebView) -> Bool {
        // Try offline/offline.html first to match Android packaging, then fall back to root
        let bundle = Bundle.main
        let offlineURL = bundle.url(forResource: "offline", withExtension: "html", subdirectory: offlineSubdirectory)
            ?? bundle.url(forResource: "offline", withExtension: "html")

        guard let offlineURL else {
            return false
        }

        offlinePageVisible = true
        offlineSnapshotVisibleURL = nil
        OfflineCacheService.shared.clearActiveOfflineRoute()
        let readAccessURL = offlineURL.deletingLastPathComponent()
        webView.loadFileURL(offlineURL, allowingReadAccessTo: readAccessURL)
        viewModel.setLoading(false, fromCache: true)
        return true
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

    private func loadCachedSnapshotIfNeeded(in webView: WKWebView, for url: URL) -> Bool {
        let key = snapshotKey(for: url)
        if offlineSnapshotVisibleURL == key {
            return true
        }

        if OfflineCacheService.shared.loadSnapshot(in: webView, for: url) {
            offlinePageVisible = false
            offlineSnapshotVisibleURL = key
            viewModel.setLoading(false, fromCache: true)
            return true
        }

        offlineSnapshotVisibleURL = nil
        return false
    }

    private func isOfflineSnapshotVisible(for url: URL) -> Bool {
        offlineSnapshotVisibleURL == snapshotKey(for: url)
    }

    private func snapshotKey(for url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        components.fragment = nil
        return components.url?.absoluteString ?? url.absoluteString
    }
}
