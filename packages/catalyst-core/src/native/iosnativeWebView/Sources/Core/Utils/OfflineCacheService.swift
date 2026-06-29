import Foundation
import WebKit
import os
#if canImport(CryptoKit)
import CryptoKit
#endif

private let offlineLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "OfflineCache")

final class OfflineCacheService {
    static let shared = OfflineCacheService()
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

    private init() {
        let baseDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        cacheDirectory = baseDirectory.appendingPathComponent("CatalystOffline", isDirectory: true)
        routeDirectory = cacheDirectory.appendingPathComponent("routes", isDirectory: true)
        manifestURL = cacheDirectory.appendingPathComponent("manifest.json")

        try? FileManager.default.createDirectory(at: routeDirectory, withIntermediateDirectories: true)
        manifest = loadCachedManifest()
    }

    func storeRouteSnapshot(for request: URLRequest, webView: WKWebView?) {
        guard let url = request.url, isHTTP(url) else { return }
        let normalizedURL = normalizeSnapshotURL(url)
        let snapshotKey = normalizedURL.absoluteString

        guard markSnapshotStarted(snapshotKey) else { return }

        Task {
            defer { self.markSnapshotFinished(snapshotKey) }

            _ = await refreshManifestAsync(for: url, request: request, webView: webView)
            guard self.isOfflineRoute(url) else { return }
            let fileURL = snapshotFileURL(for: normalizedURL)
            guard !isFreshSnapshot(fileURL) else { return }

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
                guard let httpResponse = response as? HTTPURLResponse else { return }
                let contentType = httpResponse.value(forHTTPHeaderField: "Content-Type") ?? ""

                guard httpResponse.statusCode == 200,
                      contentType.localizedCaseInsensitiveContains("text/html"),
                      !data.isEmpty else { return }

                try? FileManager.default.createDirectory(
                    at: fileURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: fileURL)
                offlineLogger.debug("Stored route snapshot: \(normalizedURL.absoluteString)")
            } catch {
                offlineLogger.debug("Unable to store route snapshot \(normalizedURL.absoluteString): \(error.localizedDescription)")
            }
        }
    }

    func loadSnapshot(in webView: WKWebView, for url: URL) -> Bool {
        guard isOfflineRoute(url),
              let data = try? Data(contentsOf: snapshotFileURL(for: normalizeSnapshotURL(url))) else {
            return false
        }

        webView.load(
            data,
            mimeType: "text/html",
            characterEncodingName: "UTF-8",
            baseURL: normalizeSnapshotURL(url)
        )
        return true
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

    func clearAll() {
        queue.async(flags: .barrier) {
            self.manifest = nil
            self.ongoingSnapshots.removeAll()
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
            return parsed
        } catch {
            offlineLogger.debug("Unable to refresh offline manifest: \(error.localizedDescription)")
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
