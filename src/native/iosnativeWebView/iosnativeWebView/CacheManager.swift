import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "CacheManager")

actor CacheManager {
    static let shared = CacheManager()
    
    private let memoryCapacity = 20 * 1024 * 1024  // 20MB
    private let diskCapacity = 100 * 1024 * 1024   // 100MB
    private let cachePath = "WebViewCache"
    private let session: URLSession
    private var resourceCache: [String: CachedResource] = [:]
    
    private struct CachedResource {
        let data: Data
        let timestamp: Date
        let mimeType: String
        let response: HTTPURLResponse?
    }
    
    private init() {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.urlCache = URLCache(memoryCapacity: memoryCapacity,
                                       diskCapacity: diskCapacity,
                                       diskPath: cachePath)
        session = URLSession(configuration: configuration)
        logger.info("Cache initialized with resource caching support")
    }
    
    func shouldCacheURL(_ url: URL) -> Bool {
            let urlString = url.absoluteString
            return ConfigConstants.cachePattern.contains { pattern in
                guard let regex = try? NSRegularExpression(
                    pattern: pattern.replacingOccurrences(of: "*", with: ".*"),
                    options: .caseInsensitive
                ) else {
                    return false
                }
                
                let range = NSRange(urlString.startIndex..., in: urlString)
                return regex.firstMatch(in: urlString, options: [], range: range) != nil
            }
        }
    
    func hasCachedResponse(for request: URLRequest) async -> Bool {
        let urlString = request.url?.absoluteString ?? ""
        
        // Check in-memory cache
        if let cachedResource = resourceCache[urlString],
           isResourceValid(cachedResource) {
            return true
        }
        
        // Check URL cache
        return session.configuration.urlCache?.cachedResponse(for: request) != nil
    }
    
    func getCachedData(for request: URLRequest) async -> Data? {
        let urlString = request.url?.absoluteString ?? ""
        
        // Check in-memory cache first
        if let cachedResource = resourceCache[urlString],
           isResourceValid(cachedResource) {
            logger.info("Resource loaded from memory cache: \(urlString)")
            return cachedResource.data
        }
        
        // Check URL cache
        if let cachedResponse = session.configuration.urlCache?.cachedResponse(for: request) {
            logger.info("Resource loaded from URL cache: \(urlString)")
            return cachedResponse.data
        }
        
        return nil
    }
    
    func storeCachedResponse(_ response: HTTPURLResponse, data: Data, for request: URLRequest) {
        guard let urlString = request.url?.absoluteString else { return }
        
        // Store in memory cache
        let resource = CachedResource(
            data: data,
            timestamp: Date(),
            mimeType: response.mimeType ?? "application/octet-stream",
            response: response
        )
        resourceCache[urlString] = resource
        
        // Store in URL cache
        let cachedResponse = CachedURLResponse(
            response: response,
            data: data,
            userInfo: nil,
            storagePolicy: .allowed
        )
        session.configuration.urlCache?.storeCachedResponse(cachedResponse, for: request)
        
        logger.info("Resource cached: \(urlString)")
    }
    
    func loadURL(_ url: URL) async throws -> Data {
        let request = createCacheableRequest(from: url)
        
        // Try to get from cache first
        if let cachedData = await getCachedData(for: request) {
            return cachedData
        }
        
        // Load from network
        do {
            let (data, response) = try await session.data(for: request)
            
            if let httpResponse = response as? HTTPURLResponse,
               isCacheableResponse(httpResponse) {
                await storeCachedResponse(httpResponse, data: data, for: request)
            }
            
            return data
        } catch {
            logger.error("Failed to load resource: \(error.localizedDescription)")
            throw error
        }
    }
    
    private func isResourceValid(_ resource: CachedResource) -> Bool {
        let cacheTimeout = 3600.0 // 1 hour
        return Date().timeIntervalSince(resource.timestamp) < cacheTimeout
    }
    
    func clearCache() {
        resourceCache.removeAll()
        session.configuration.urlCache?.removeAllCachedResponses()
        logger.info("All caches cleared")
    }
    
    func createCacheableRequest(from url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        return request
    }
    
    func isCacheableResponse(_ response: HTTPURLResponse) -> Bool {
        guard let url = response.url else { return false }
        return (200...299 ~= response.statusCode) && shouldCacheURL(url)
    }
    
    func getCacheStatistics() -> (memoryUsed: Int, diskUsed: Int) {
        let memoryUsed = session.configuration.urlCache?.currentMemoryUsage ?? 0
        let diskUsed = session.configuration.urlCache?.currentDiskUsage ?? 0
        return (memoryUsed, diskUsed)
    }
}
