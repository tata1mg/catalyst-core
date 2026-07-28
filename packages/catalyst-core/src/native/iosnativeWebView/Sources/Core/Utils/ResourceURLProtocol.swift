import Foundation
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "ResourceProtocol")

final class ResourceURLProtocol: URLProtocol {
    private var dataTask: URLSessionDataTask?
    private static let handledKey = "ResourceURLProtocolHandled"
    private static var isRegistered = false
    
    // MARK: - Protocol Registration
    static func register() {
        guard !isRegistered else { return }
        URLProtocol.registerClass(self)
        isRegistered = true
        logger.info("✅ ResourceURLProtocol registered for GET cache interception")
    }
    
    static func unregister() {
        guard isRegistered else { return }
        URLProtocol.unregisterClass(self)
        isRegistered = false
    }
    
    // MARK: - URLProtocol
  override class func canInit(with request: URLRequest) -> Bool {
    guard let url = request.url else {
        logger.debug("🔍 ResourceURLProtocol.canInit: NO URL")
        return false
    }

    let httpMethod = request.httpMethod?.uppercased() ?? "GET"
    let hasBody = request.httpBody != nil || request.httpBodyStream != nil
    let bodySize = request.httpBody?.count ?? 0

    logger.info("🔍 ResourceURLProtocol.canInit: \(httpMethod) \(url.absoluteString) [body: \(hasBody), size: \(bodySize) bytes]")

    // Check if we've already handled this request
    if URLProtocol.property(forKey: handledKey, in: request) != nil {
        logger.debug("🔍 ResourceURLProtocol.canInit: Already handled, returning false")
        return false
    }

    // Only intercept GET requests - POST/PUT/PATCH/DELETE should go directly
    // to preserve request body and avoid caching side-effects
    if httpMethod != "GET" {
        logger.info("🔍 ResourceURLProtocol.canInit: Skipping \(httpMethod) request - NOT intercepting")
        return false
    }

    if request.value(forHTTPHeaderField: "X-Catalyst-Offline-Snapshot-Fetch") == "1" ||
        url.path == "/catalyst-offline-manifest.json" ||
        url.path == "/catalyst-sw.js" ||
        url.path == "/offline.html" {
        logger.info("🔍 ResourceURLProtocol.canInit: Skipping internal Catalyst offline request")
        return false
    }

    let shouldCache = CacheManager.shared.shouldCacheRequest(request)
    logger.info("🔍 ResourceURLProtocol.canInit: GET request, shouldCache=\(shouldCache)")
    return shouldCache
}

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }
    
    override func startLoading() {
        guard let url = request.url else {
            logger.error("❌ No URL in request")
            return
        }

        let httpMethod = request.httpMethod?.uppercased() ?? "GET"
        let bodySize = request.httpBody?.count ?? 0
        logger.error("🚨 startLoading CALLED - This should NEVER happen for POST! Method: \(httpMethod), URL: \(url.absoluteString), BodySize: \(bodySize)")

        // Mark this request as handled to prevent recursion
        guard let mutableRequest = (request as NSURLRequest).mutableCopy() as? NSMutableURLRequest else {
            logger.error("❌ Failed to create mutable copy of request")
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        URLProtocol.setProperty(true, forKey: ResourceURLProtocol.handledKey, in: mutableRequest)
        
        Task { [weak self] in
            guard let self else { return }
            do {
                // Try to load from cache first
                let cacheableRequest = CacheManager.shared.createCacheableRequest(from: url)
                let (cachedData, cacheState, mimeType) = await CacheManager.shared.getCachedResource(for: cacheableRequest)
                
                if let cachedData = cachedData, cacheState != .expired {
                    logger.info("✅ Serving cached content for: \(url.absoluteString)")
                    
                    // Create response
                    var headers: [String: String] = [:]
                    if let mimeType = mimeType {
                        headers["Content-Type"] = mimeType
                    }
                    
                    guard let response = HTTPURLResponse(
                        url: url,
                        statusCode: 200,
                        httpVersion: "HTTP/1.1",
                        headerFields: headers
                    ) else {
                        logger.error("❌ Failed to create HTTP response for cached content")
                        await MainActor.run { [weak self] in
                            guard let self else { return }
                            self.client?.urlProtocol(self, didFailWithError: URLError(.cannotCreateFile))
                        }
                        return
                    }
                    
                    // Send cached response
                    await MainActor.run { [weak self] in
                        guard let self else { return }
                        self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
                        self.client?.urlProtocol(self, didLoad: cachedData)
                        self.client?.urlProtocolDidFinishLoading(self)
                    }
                    return
                }
                
                // If not in cache or expired, load from network using URLSession
                logger.info("🌐 Fetching from network: \(url.absoluteString)")
                
                let config = URLSessionConfiguration.ephemeral
                config.requestCachePolicy = .reloadIgnoringLocalCacheData
                config.protocolClasses = []
                let session = URLSession(configuration: config)
                
                let (data, response) = try await session.data(for: mutableRequest as URLRequest)
                
                if let httpResponse = response as? HTTPURLResponse {
                    // Cache the response if it's valid
                    if CacheManager.shared.isCacheableResponse(httpResponse, for: request) {
                        CacheManager.shared.storeCachedResponse(httpResponse, data: data, for: request)
                    }
                    
                    // Send response to client
                    await MainActor.run { [weak self] in
                        guard let self else { return }
                        self.client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .allowed)
                        self.client?.urlProtocol(self, didLoad: data)
                        self.client?.urlProtocolDidFinishLoading(self)
                    }
                }
            } catch {
                logger.error("❌ Failed to load resource: \(error.localizedDescription)")
                await MainActor.run { [weak self] in
                    guard let self else { return }
                    self.client?.urlProtocol(self, didFailWithError: error)
                }
            }
        }
    }
    
    override func stopLoading() {
        dataTask?.cancel()
    }
}

extension ResourceURLProtocol: @unchecked Sendable {}
