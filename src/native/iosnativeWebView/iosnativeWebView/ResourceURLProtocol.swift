import Foundation
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "ResourceProtocol")

class ResourceURLProtocol: URLProtocol {
    private var dataTask: URLSessionDataTask?
    
    // MARK: - Protocol Registration
    static func register() {
        // Register for WKWebView support
        URLProtocol.registerClass(self)
        
        // Enable URLProtocol in WKWebView
        if let cls = NSClassFromString("WKBrowsingContextController") as AnyClass? {
            let selector = NSSelectorFromString("registerSchemeForCustomProtocol:")
            if cls.responds(to: selector) {
                let _ = cls.perform(selector, with: "http", afterDelay: 0)
                let _ = cls.perform(selector, with: "https", afterDelay: 0)
            }
        }
    }
    
    static func unregister() {
        URLProtocol.unregisterClass(self)
    }
    
    // MARK: - URLProtocol
    override class func canInit(with request: URLRequest) -> Bool {
        guard let url = request.url else { return false }
        
        // Create a Task to check if we should handle this URL
        // Note: This is not ideal but necessary due to actor isolation
        let semaphore = DispatchSemaphore(value: 0)
        var shouldHandle = false
        
        Task {
            shouldHandle = await CacheManager.shared.shouldCacheURL(url)
            semaphore.signal()
        }
        
        _ = semaphore.wait(timeout: .now() + 0.1)
        
        if shouldHandle {
            logger.info("🎯 Will handle resource: \(url.absoluteString)")
        }
        
        return shouldHandle
    }
    
    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }
    
    override func startLoading() {
        guard let url = request.url else {
            logger.error("❌ No URL in request")
            return
        }
        
        Task {
            do {
                // Try to load from cache first
                let cacheableRequest = await CacheManager.shared.createCacheableRequest(from: url)
                let (cachedData, cacheState, mimeType) = await CacheManager.shared.getCachedResource(for: cacheableRequest)
                
                if let cachedData = cachedData, cacheState != .expired {
                    logger.info("✅ Serving cached content for: \(url.absoluteString)")
                    
                    // Create response
                    var headers: [String: String] = [:]
                    if let mimeType = mimeType {
                        headers["Content-Type"] = mimeType
                    }
                    
                    let response = HTTPURLResponse(
                        url: url,
                        statusCode: 200,
                        httpVersion: "HTTP/1.1",
                        headerFields: headers
                    )!
                    
                    // Send cached response
                    await MainActor.run {
                        self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
                        self.client?.urlProtocol(self, didLoad: cachedData)
                        self.client?.urlProtocolDidFinishLoading(self)
                    }
                    return
                }
                
                // If not in cache or expired, load from network
                logger.info("🌐 Fetching from network: \(url.absoluteString)")
                let (data, response) = try await URLSession.shared.data(for: request)
                
                if let httpResponse = response as? HTTPURLResponse {
                    // Cache the response if it's valid
                    if await CacheManager.shared.isCacheableResponse(httpResponse) {
                        await CacheManager.shared.storeCachedResponse(httpResponse, data: data, for: request)
                    }
                    
                    // Send response to client
                    await MainActor.run {
                        self.client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .allowed)
                        self.client?.urlProtocol(self, didLoad: data)
                        self.client?.urlProtocolDidFinishLoading(self)
                    }
                }
            } catch {
                logger.error("❌ Failed to load resource: \(error.localizedDescription)")
                await MainActor.run {
                    self.client?.urlProtocol(self, didFailWithError: error)
                }
            }
        }
    }
    
    override func stopLoading() {
        dataTask?.cancel()
    }
}
