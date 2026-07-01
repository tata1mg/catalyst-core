import Foundation
import WebKit
import os
#if canImport(CryptoKit)
import CryptoKit
#endif

private let offlineLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "OfflineCache")

final class OfflineCacheService {
    static let shared = OfflineCacheService()
    static let offlineHTTPScheme = "catalyst-offline-http"
    static let offlineHTTPSScheme = "catalyst-offline-https"
    private static let snapshotMaxAge: TimeInterval = 24 * 60 * 60
    private static let assetExtensions = Set([
        ".js",
        ".mjs",
        ".css",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".webp",
        ".ico",
        ".woff",
        ".woff2",
        ".ttf",
        ".eot"
    ])

    private struct OfflineRoute {
        let pattern: String
        let regex: String
    }

    private struct OfflineManifest {
        let buildId: String
        let routes: [OfflineRoute]
    }

    private let queue = DispatchQueue(label: "com.app.offlinecache", attributes: .concurrent)
    private let cacheDirectory: URL
    private let routeDirectory: URL
    private let manifestURL: URL
    private var manifest: OfflineManifest?
    private var ongoingSnapshots: Set<String> = []
    private var activeOfflineRouteOrigin: String?

    private init() {
        let baseDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        cacheDirectory = baseDirectory.appendingPathComponent("CatalystOffline", isDirectory: true)
        routeDirectory = cacheDirectory.appendingPathComponent("routes", isDirectory: true)
        manifestURL = cacheDirectory.appendingPathComponent("manifest.json")

        try? FileManager.default.createDirectory(at: routeDirectory, withIntermediateDirectories: true)
        manifest = loadCachedManifest()
        if let manifest {
            offlineLogger.info("Loaded cached offline manifest buildId=\(manifest.buildId), routes=\(manifest.routes.count)")
        } else {
            offlineLogger.info("No cached offline manifest found")
        }
    }

    func storeRouteSnapshot(for request: URLRequest, webView: WKWebView?) {
        guard let url = request.url, isHTTP(url) else { return }
        let normalizedURL = normalizeSnapshotURL(url)
        let snapshotKey = normalizedURL.absoluteString

        guard markSnapshotStarted(snapshotKey) else {
            offlineLogger.info("Snapshot fetch already in progress: \(snapshotKey)")
            return
        }
        offlineLogger.info("Snapshot store requested: \(snapshotKey)")

        Task {
            defer { self.markSnapshotFinished(snapshotKey) }

            let refreshedManifest = await refreshManifestAsync(for: url, request: request, webView: webView)
            guard self.isOfflineRoute(url) else {
                offlineLogger.info("Snapshot skipped; route is not offline eligible: \(url.absoluteString), manifestRoutes=\(refreshedManifest?.routes.count ?? 0)")
                return
            }
            let fileURL = snapshotFileURL(for: normalizedURL)
            guard !isFreshSnapshot(fileURL) else {
                offlineLogger.info("Snapshot already fresh: \(normalizedURL.absoluteString)")
                if let data = try? Data(contentsOf: fileURL) {
                    await self.cacheSnapshotAssets(from: data, baseURL: normalizedURL, originalRequest: request, webView: webView)
                }
                return
            }

            do {
                var snapshotRequest = URLRequest(url: normalizedURL)
                snapshotRequest.httpMethod = "GET"
                snapshotRequest.timeoutInterval = 15
                snapshotRequest.setValue("1", forHTTPHeaderField: "X-Catalyst-Offline-Snapshot-Fetch")
                for (key, value) in request.allHTTPHeaderFields ?? [:] {
                    if shouldForwardHeader(key) {
                        snapshotRequest.setValue(value, forHTTPHeaderField: key)
                    }
                }

                if let cookieHeader = await cookieHeader(for: normalizedURL, webView: webView), !cookieHeader.isEmpty {
                    snapshotRequest.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
                }

                let (data, response) = try await URLSession.shared.data(for: snapshotRequest)
                guard let httpResponse = response as? HTTPURLResponse else {
                    offlineLogger.info("Snapshot fetch returned non-HTTP response: \(normalizedURL.absoluteString)")
                    return
                }
                let contentType = httpResponse.value(forHTTPHeaderField: "Content-Type") ?? ""
                offlineLogger.info("Snapshot fetch response: url=\(normalizedURL.absoluteString), status=\(httpResponse.statusCode), contentType=\(contentType), bytes=\(data.count)")

                guard httpResponse.statusCode == 200,
                      contentType.localizedCaseInsensitiveContains("text/html"),
                      !data.isEmpty else {
                    offlineLogger.info("Snapshot not stored; response is not cacheable HTML: \(normalizedURL.absoluteString)")
                    return
                }

                try? FileManager.default.createDirectory(
                    at: fileURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: fileURL)
                offlineLogger.info("Stored route snapshot: \(normalizedURL.absoluteString), path=\(fileURL.path)")
                await self.cacheSnapshotAssets(from: data, baseURL: normalizedURL, originalRequest: request, webView: webView)
            } catch {
                offlineLogger.info("Unable to store route snapshot \(normalizedURL.absoluteString): \(error.localizedDescription)")
            }
        }
    }

    func loadSnapshot(in webView: WKWebView, for url: URL) -> Bool {
        let normalizedURL = normalizeSnapshotURL(url)
        guard isOfflineRoute(url) else {
            let hasManifest = queue.sync { self.manifest != nil }
            offlineLogger.info("Snapshot miss; route is not offline eligible or manifest is missing: \(url.absoluteString), hasManifest=\(hasManifest)")
            return false
        }

        let fileURL = snapshotFileURL(for: normalizedURL)
        guard let data = try? Data(contentsOf: fileURL) else {
            offlineLogger.info("Snapshot miss; file not found: \(normalizedURL.absoluteString), path=\(fileURL.path)")
            return false
        }

        guard let offlineURL = offlineURL(for: normalizedURL) else {
            offlineLogger.info("Snapshot miss; unable to create offline URL: \(normalizedURL.absoluteString)")
            return false
        }

        webView.load(URLRequest(url: offlineURL))
        setActiveOfflineRouteOrigin(origin(for: url))
        offlineLogger.info("Loaded route snapshot through offline scheme: original=\(normalizedURL.absoluteString), offline=\(offlineURL.absoluteString), bytes=\(data.count)")
        return true
    }

    func snapshotData(for url: URL) -> Data? {
        let normalizedURL = normalizeSnapshotURL(url)
        guard isOfflineRoute(normalizedURL) else { return nil }
        return try? Data(contentsOf: snapshotFileURL(for: normalizedURL))
    }

    func offlineURL(for originalURL: URL) -> URL? {
        guard isHTTP(originalURL),
              var components = URLComponents(url: originalURL, resolvingAgainstBaseURL: false),
              let scheme = originalURL.scheme?.lowercased() else {
            return nil
        }
        components.scheme = scheme == "https" ? Self.offlineHTTPSScheme : Self.offlineHTTPScheme
        return components.url
    }

    func originalURL(forOfflineURL offlineURL: URL) -> URL? {
        guard var components = URLComponents(url: offlineURL, resolvingAgainstBaseURL: false),
              let scheme = offlineURL.scheme?.lowercased() else {
            return nil
        }

        if scheme == Self.offlineHTTPSScheme {
            components.scheme = "https"
        } else if scheme == Self.offlineHTTPScheme {
            components.scheme = "http"
        } else {
            return nil
        }

        return components.url
    }

    func isOfflineRoute(_ url: URL) -> Bool {
        guard isHTTP(url) else { return false }
        let path = url.path.isEmpty ? "/" : url.path
        let currentManifest = queue.sync { manifest }
        guard let currentManifest else { return false }

        return currentManifest.routes.contains { route in
            guard let regex = try? NSRegularExpression(pattern: route.regex, options: [.caseInsensitive]) else {
                return false
            }
            let range = NSRange(path.startIndex..., in: path)
            return regex.firstMatch(in: path, options: [], range: range) != nil
        }
    }

    func shouldCacheAssetURL(_ url: URL) -> Bool {
        guard isHTTP(url) else { return false }
        let path = url.path.lowercased()
        return Self.assetExtensions.contains { path.hasSuffix($0) }
    }

    func prepareActiveOfflineRoute(for request: URLRequest, webView: WKWebView?) async -> Bool {
        guard let url = request.url, isHTTP(url) else {
            clearActiveOfflineRoute()
            return false
        }

        if queue.sync(execute: { manifest == nil }) {
            _ = await refreshManifestAsync(for: url, request: request, webView: webView)
        }

        let isActive = isOfflineRoute(url)
        setActiveOfflineRouteOrigin(isActive ? origin(for: url) : nil)
        return isActive
    }

    func clearActiveOfflineRoute() {
        setActiveOfflineRouteOrigin(nil)
    }

    func shouldCacheOfflineRouteSubresource(_ request: URLRequest) -> Bool {
        guard let url = request.url,
              isHTTP(url),
              (request.httpMethod?.uppercased() ?? "GET") == "GET",
              !isInternalOfflineRuntimeURL(url),
              queue.sync(execute: { activeOfflineRouteOrigin }) == origin(for: url) else {
            return false
        }

        let destination = request.value(forHTTPHeaderField: "Sec-Fetch-Dest")?.lowercased()
        if destination == "document" || destination == "empty" {
            return false
        }
        if let destination,
           ["script", "style", "image", "font", "audio", "video", "track", "manifest"].contains(destination) {
            return true
        }

        let accept = request.value(forHTTPHeaderField: "Accept")?.lowercased() ?? ""
        if accept.contains("text/html") ||
            accept.contains("application/json") ||
            accept.contains("text/event-stream") {
            return false
        }
        if accept.contains("text/css") ||
            accept.contains("javascript") ||
            accept.contains("image/") ||
            accept.contains("font/") ||
            accept.contains("application/font") ||
            accept.contains("application/wasm") {
            return true
        }

        return shouldCacheAssetURL(url)
    }

    func clearAll() {
        queue.async(flags: .barrier) {
            self.manifest = nil
            self.ongoingSnapshots.removeAll()
            self.activeOfflineRouteOrigin = nil
            try? FileManager.default.removeItem(at: self.cacheDirectory)
            try? FileManager.default.createDirectory(at: self.routeDirectory, withIntermediateDirectories: true)
            offlineLogger.info("Offline route snapshots cleared")
        }
    }

    private func refreshManifestAsync(for url: URL, request: URLRequest?, webView: WKWebView?) async -> OfflineManifest? {
        do {
            let manifestRemoteURL = manifestURLFor(url)
            var manifestRequest = URLRequest(url: manifestRemoteURL)
            manifestRequest.httpMethod = "GET"
            manifestRequest.timeoutInterval = 10

            for (key, value) in request?.allHTTPHeaderFields ?? [:] {
                if shouldForwardHeader(key) {
                    manifestRequest.setValue(value, forHTTPHeaderField: key)
                }
            }

            if let cookieHeader = await cookieHeader(for: manifestRemoteURL, webView: webView), !cookieHeader.isEmpty {
                manifestRequest.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
            }

            let (data, response) = try await URLSession.shared.data(for: manifestRequest)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                return queue.sync { manifest }
            }

            let parsed = try parseManifest(data)
            try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
            try data.write(to: manifestURL)
            queue.sync(flags: .barrier) {
                self.manifest = parsed
            }
            offlineLogger.info("Refreshed offline manifest: url=\(manifestRemoteURL.absoluteString), buildId=\(parsed.buildId), routes=\(parsed.routes.count)")
            return parsed
        } catch {
            offlineLogger.info("Unable to refresh offline manifest: \(error.localizedDescription)")
            return queue.sync { manifest }
        }
    }

    private func loadCachedManifest() -> OfflineManifest? {
        guard let data = try? Data(contentsOf: manifestURL) else { return nil }
        return try? parseManifest(data)
    }

    private func parseManifest(_ data: Data) throws -> OfflineManifest {
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let buildId = json["buildId"] as? String ?? "unknown"

        let routes = (json["routes"] as? [[String: Any]] ?? []).compactMap { route -> OfflineRoute? in
            guard let pattern = route["pattern"] as? String,
                  let regex = route["regex"] as? String,
                  !pattern.isEmpty,
                  !regex.isEmpty else { return nil }
            return OfflineRoute(pattern: pattern, regex: regex)
        }

        return OfflineManifest(buildId: buildId, routes: routes)
    }

    private func manifestURLFor(_ url: URL) -> URL {
        var components = URLComponents()
        components.scheme = url.scheme
        components.host = url.host
        components.port = url.port
        components.path = "/catalyst-offline-manifest.json"
        return components.url!
    }

    private func snapshotFileURL(for url: URL) -> URL {
        let currentManifest = queue.sync { manifest }
        let namespace = "\(origin(for: url)):\(currentManifest?.buildId ?? "unknown")"
        return routeDirectory
            .appendingPathComponent(sha256(namespace), isDirectory: true)
            .appendingPathComponent("\(sha256(url.absoluteString)).html")
    }

    private func normalizeSnapshotURL(_ url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        components.fragment = nil
        return components.url ?? url
    }

    private func origin(for url: URL) -> String {
        var components = URLComponents()
        components.scheme = url.scheme
        components.host = url.host
        components.port = url.port
        return components.string ?? url.host ?? "unknown"
    }

    private func isHTTP(_ url: URL) -> Bool {
        let scheme = url.scheme?.lowercased()
        return scheme == "http" || scheme == "https"
    }

    private func isInternalOfflineRuntimeURL(_ url: URL) -> Bool {
        return url.path == "/catalyst-offline-manifest.json" ||
            url.path == "/catalyst-sw.js" ||
            url.path == "/offline.html"
    }

    private func setActiveOfflineRouteOrigin(_ origin: String?) {
        queue.sync(flags: .barrier) {
            self.activeOfflineRouteOrigin = origin
        }
    }

    private func cacheSnapshotAssets(from data: Data, baseURL: URL, originalRequest: URLRequest, webView: WKWebView?) async {
        guard let html = String(data: data, encoding: .utf8) else { return }

        var assetURLs = extractAssetURLs(from: html, baseURL: baseURL)
        guard !assetURLs.isEmpty else {
            offlineLogger.info("Snapshot asset warmup skipped; no cacheable assets found: \(baseURL.absoluteString)")
            return
        }

        offlineLogger.info("Snapshot asset warmup started: page=\(baseURL.absoluteString), assets=\(assetURLs.count)")

        var cachedCount = 0
        var index = 0
        var seen = Set(assetURLs.map(\.absoluteString))
        while index < assetURLs.count {
            let assetURL = assetURLs[index]
            index += 1
            do {
                var assetRequest = URLRequest(url: assetURL)
                assetRequest.httpMethod = "GET"
                assetRequest.timeoutInterval = 15
                assetRequest.setValue("1", forHTTPHeaderField: "X-Catalyst-Offline-Snapshot-Fetch")
                for (key, value) in originalRequest.allHTTPHeaderFields ?? [:] {
                    if shouldForwardHeader(key) {
                        assetRequest.setValue(value, forHTTPHeaderField: key)
                    }
                }

                if let cookieHeader = await cookieHeader(for: assetURL, webView: webView), !cookieHeader.isEmpty {
                    assetRequest.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
                }

                let configuration = URLSessionConfiguration.ephemeral
                configuration.protocolClasses = []
                let session = URLSession(configuration: configuration)
                let (assetData, response) = try await session.data(for: assetRequest)
                guard let httpResponse = response as? HTTPURLResponse,
                      200...299 ~= httpResponse.statusCode,
                      !assetData.isEmpty,
                      !isDocumentOrDataResponse(httpResponse) else {
                    offlineLogger.info("Snapshot asset not cached: \(assetURL.absoluteString)")
                    continue
                }

                CacheManager.shared.storeCachedResponse(httpResponse, data: assetData, for: assetRequest)
                if httpResponse.mimeType?.localizedCaseInsensitiveContains("text/css") == true,
                   let css = String(data: assetData, encoding: .utf8) {
                    for nestedURL in extractCSSAssetURLs(from: css, stylesheetURL: assetURL, pageBaseURL: baseURL) {
                        if seen.insert(nestedURL.absoluteString).inserted {
                            assetURLs.append(nestedURL)
                        }
                    }
                }
                cachedCount += 1
            } catch {
                offlineLogger.info("Unable to warm snapshot asset \(assetURL.absoluteString): \(error.localizedDescription)")
            }
        }

        offlineLogger.info("Snapshot asset warmup finished: page=\(baseURL.absoluteString), cached=\(cachedCount), total=\(assetURLs.count)")
    }

    private func extractAssetURLs(from html: String, baseURL: URL) -> [URL] {
        let tagPattern = #"<\s*(script|link|img|source|video|audio|track|iframe)\b[^>]*>"#
        guard let tagRegex = try? NSRegularExpression(pattern: tagPattern, options: [.caseInsensitive]) else {
            return []
        }

        var urls: [URL] = []
        var seen = Set<String>()
        let range = NSRange(html.startIndex..., in: html)

        for match in tagRegex.matches(in: html, options: [], range: range) {
            guard let tagRange = Range(match.range(at: 0), in: html),
                  let nameRange = Range(match.range(at: 1), in: html) else { continue }
            let tag = String(html[tagRange])
            let tagName = String(html[nameRange]).lowercased()

            for rawValue in assetValues(in: tag, tagName: tagName) {
                let decodedValue = htmlDecodeAttribute(rawValue)
                guard let assetURL = URL(string: decodedValue, relativeTo: baseURL)?.absoluteURL,
                      isCacheableSnapshotAsset(assetURL),
                  seen.insert(assetURL.absoluteString).inserted else {
                    continue
                }
                urls.append(assetURL)
            }
        }

        return urls
    }

    private func extractCSSAssetURLs(from css: String, stylesheetURL: URL, pageBaseURL: URL) -> [URL] {
        let pattern = #"url\(\s*(['"]?)([^)'"]+)\1\s*\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return []
        }

        var urls: [URL] = []
        let range = NSRange(css.startIndex..., in: css)
        for match in regex.matches(in: css, options: [], range: range) {
            guard let valueRange = Range(match.range(at: 2), in: css) else { continue }
            let rawValue = String(css[valueRange])
            if rawValue.hasPrefix("data:") || rawValue.hasPrefix("#") { continue }
            guard let assetURL = URL(string: rawValue, relativeTo: stylesheetURL)?.absoluteURL,
                  isCacheableSnapshotAsset(assetURL) else {
                continue
            }
            urls.append(assetURL)
        }
        return urls
    }

    private func assetValues(in tag: String, tagName: String) -> [String] {
        var attributes: [String: String] = [:]
        let attributePattern = #"([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*["']([^"']+)["']"#
        if let regex = try? NSRegularExpression(pattern: attributePattern, options: [.caseInsensitive]) {
            let range = NSRange(tag.startIndex..., in: tag)
            for match in regex.matches(in: tag, options: [], range: range) {
                guard let nameRange = Range(match.range(at: 1), in: tag),
                      let valueRange = Range(match.range(at: 2), in: tag) else { continue }
                attributes[String(tag[nameRange]).lowercased()] = String(tag[valueRange])
            }
        }

        switch tagName {
        case "script", "img", "source", "video", "audio", "track", "iframe":
            return attributes["src"].map { [$0] } ?? []
        case "link":
            guard let href = attributes["href"] else { return [] }
            let rel = attributes["rel"]?.lowercased() ?? ""
            let asValue = attributes["as"]?.lowercased() ?? ""
            let isAssetLink = rel.contains("stylesheet") ||
                rel.contains("preload") ||
                rel.contains("modulepreload") ||
                rel.contains("icon") ||
                ["script", "style", "font", "image"].contains(asValue)
            return isAssetLink ? [href] : []
        default:
            return []
        }
    }

    private func isCacheableSnapshotAsset(_ url: URL) -> Bool {
        guard isHTTP(url),
              !isInternalOfflineRuntimeURL(url) else {
            return false
        }

        return true
    }

    private func isDocumentOrDataResponse(_ response: HTTPURLResponse) -> Bool {
        let mimeType = response.mimeType?.lowercased() ?? ""
        return mimeType == "text/html" ||
            mimeType == "application/json" ||
            mimeType.hasSuffix("+json") ||
            mimeType == "text/event-stream"
    }

    func rewriteSameOriginReferencesForOffline(_ data: Data, originalURL: URL) -> Data? {
        guard var text = String(data: data, encoding: .utf8) else {
            return nil
        }

        for rawValue in absoluteHTTPReferences(in: text) {
            let decodedValue = htmlDecodeAttribute(rawValue)
            guard let assetURL = URL(string: decodedValue),
                  shouldRewriteOfflineReference(assetURL),
                  let offlineURL = offlineURL(for: assetURL) else {
                continue
            }

            let replacement = rawValue.contains("&amp;")
                ? htmlEncodeAttribute(offlineURL.absoluteString)
                : offlineURL.absoluteString
            text = text.replacingOccurrences(of: rawValue, with: replacement)

            let escapedRawValue = escapeForwardSlashes(rawValue)
            let escapedReplacement = escapeForwardSlashes(replacement)
            text = text.replacingOccurrences(of: escapedRawValue, with: escapedReplacement)
        }
        return text.data(using: .utf8)
    }

    private func absoluteHTTPReferences(in text: String) -> [String] {
        let pattern = #"https?://[^"'\\\s<>)]+"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return []
        }

        var values: [String] = []
        var seen = Set<String>()
        let range = NSRange(text.startIndex..., in: text)
        for match in regex.matches(in: text, options: [], range: range) {
            guard let valueRange = Range(match.range(at: 0), in: text) else { continue }
            var value = String(text[valueRange])
            while let last = value.last, [".", ",", ";", ":"].contains(last) {
                value.removeLast()
            }
            if seen.insert(value).inserted {
                values.append(value)
            }
        }
        return values
    }

    private func shouldRewriteOfflineReference(_ url: URL) -> Bool {
        guard isCacheableSnapshotAsset(url) else { return false }
        let host = url.host?.lowercased() ?? ""
        return shouldCacheAssetURL(url) ||
            host == "fonts.googleapis.com" ||
            host == "fonts.gstatic.com"
    }

    private func htmlDecodeAttribute(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&#38;", with: "&")
    }

    private func htmlEncodeAttribute(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
    }

    func mimeType(for url: URL) -> String {
        let path = url.path.lowercased()
        if path.hasSuffix(".js") || path.hasSuffix(".mjs") { return "application/javascript" }
        if path.hasSuffix(".css") { return "text/css" }
        if path.hasSuffix(".png") { return "image/png" }
        if path.hasSuffix(".jpg") || path.hasSuffix(".jpeg") { return "image/jpeg" }
        if path.hasSuffix(".gif") { return "image/gif" }
        if path.hasSuffix(".svg") { return "image/svg+xml" }
        if path.hasSuffix(".webp") { return "image/webp" }
        if path.hasSuffix(".ico") { return "image/x-icon" }
        if path.hasSuffix(".woff") { return "font/woff" }
        if path.hasSuffix(".woff2") { return "font/woff2" }
        if path.hasSuffix(".ttf") { return "font/ttf" }
        if path.hasSuffix(".eot") { return "application/vnd.ms-fontobject" }
        return "application/octet-stream"
    }

    private func escapeForwardSlashes(_ value: String) -> String {
        value.replacingOccurrences(of: "/", with: "\\/")
    }

    private func shouldForwardHeader(_ header: String) -> Bool {
        return header.caseInsensitiveCompare("Cookie") != .orderedSame &&
            header.caseInsensitiveCompare("Host") != .orderedSame &&
            header.caseInsensitiveCompare("Cache-Control") != .orderedSame &&
            header.caseInsensitiveCompare("Pragma") != .orderedSame
    }

    private func isFreshSnapshot(_ url: URL) -> Bool {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modifiedAt = attributes[.modificationDate] as? Date else {
            return false
        }
        return Date().timeIntervalSince(modifiedAt) < Self.snapshotMaxAge
    }

    private func markSnapshotStarted(_ key: String) -> Bool {
        var inserted = false
        queue.sync(flags: .barrier) {
            inserted = ongoingSnapshots.insert(key).inserted
        }
        return inserted
    }

    private func markSnapshotFinished(_ key: String) {
        queue.async(flags: .barrier) {
            self.ongoingSnapshots.remove(key)
        }
    }

    private func cookieHeader(for url: URL, webView: WKWebView?) async -> String? {
        guard let webView else { return nil }

        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        let matchingCookies = cookies.filter { cookie in
            guard let host = url.host else { return false }
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return host == domain || host.hasSuffix(".\(domain)")
        }
        return HTTPCookie.requestHeaderFields(with: matchingCookies)["Cookie"]
    }

    private func sha256(_ value: String) -> String {
        let data = Data(value.utf8)
        #if canImport(CryptoKit)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
        #else
        return String(value.hashValue)
        #endif
    }
}

extension OfflineCacheService: @unchecked Sendable {}
