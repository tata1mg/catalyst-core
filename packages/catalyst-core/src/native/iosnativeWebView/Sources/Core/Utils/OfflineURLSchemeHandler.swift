import Foundation
import WebKit
import os

private let offlineSchemeLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "com.app",
    category: "CatalystOfflineScheme"
)

final class OfflineURLSchemeHandler: NSObject, WKURLSchemeHandler {
    static let shared = OfflineURLSchemeHandler()

    private override init() {
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let offlineURL = urlSchemeTask.request.url,
              let originalURL = OfflineCacheService.shared.originalURL(forOfflineURL: offlineURL) else {
            offlineSchemeLogger.info("SCHEME miss reason=invalid-url url=\(urlSchemeTask.request.url?.absoluteString ?? "nil")")
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        Task {
            if let snapshot = OfflineCacheService.shared.snapshotData(for: originalURL) {
                let data = OfflineCacheService.shared.rewriteSameOriginReferencesForOffline(
                    snapshot,
                    originalURL: originalURL
                ) ?? snapshot
                send(
                    data: data,
                    mimeType: "text/html",
                    encoding: "utf-8",
                    url: offlineURL,
                    task: urlSchemeTask
                )
                offlineSchemeLogger.info("SCHEME document-hit bytes=\(data.count) original=\(originalURL.absoluteString) offline=\(offlineURL.absoluteString)")
                return
            }

            var originalRequest = URLRequest(url: originalURL)
            originalRequest.httpMethod = "GET"
            let (cachedData, cacheState, mimeType) = await CacheManager.shared.getCachedResource(for: originalRequest)
            guard let cachedData, cacheState != .expired else {
                offlineSchemeLogger.info("SCHEME asset-miss original=\(originalURL.absoluteString) offline=\(offlineURL.absoluteString)")
                urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
                return
            }

            let data = OfflineCacheService.shared.rewriteSameOriginReferencesForOffline(
                cachedData,
                originalURL: originalURL
            ) ?? cachedData
            send(
                data: data,
                mimeType: mimeType ?? OfflineCacheService.shared.mimeType(for: originalURL),
                encoding: "utf-8",
                url: offlineURL,
                task: urlSchemeTask
            )
            offlineSchemeLogger.info("SCHEME asset-hit state=\(String(describing: cacheState)) bytes=\(data.count) mime=\(mimeType ?? "unknown") original=\(originalURL.absoluteString)")
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        offlineSchemeLogger.debug("SCHEME stop url=\(urlSchemeTask.request.url?.absoluteString ?? "nil")")
    }

    private func send(
        data: Data,
        mimeType: String,
        encoding: String,
        url: URL,
        task: WKURLSchemeTask
    ) {
        let headers = [
            "Content-Type": "\(mimeType); charset=\(encoding)",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
        ]
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}

extension OfflineURLSchemeHandler: @unchecked Sendable {}
