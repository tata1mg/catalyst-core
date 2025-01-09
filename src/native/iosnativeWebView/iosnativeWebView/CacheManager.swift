import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "CacheManager")

actor CacheManager {
    static let shared = CacheManager()
    
    enum CacheState {
        case fresh      // Content is within fresh window
        case stale     // Content is in stale-while-revalidate window
        case expired   // Content is expired
    }
    
    private struct CachePolicy {
        static let freshWindow: TimeInterval = 24 * 60 * 60  // 24 hours
        static let staleWindow: TimeInterval = 60 * 60       // 1 hour after fresh window
    }
    
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
    
    private func getCacheState(for timestamp: Date) -> CacheState {
        let age = Date().timeIntervalSince(timestamp)
        
        if age <= CachePolicy.freshWindow {
            return .fresh
        } else if age <= (CachePolicy.freshWindow + CachePolicy.staleWindow) {
            return .stale
        } else {
            return .expired
        }
    }
    
    func getCachedResource(for request: URLRequest) async -> (Data?, CacheState, String?) {
        let urlString = request.url?.absoluteString ?? ""
        
        // Check in-memory cache first
        if let cachedResource = resourceCache[urlString] {
            let state = getCacheState(for: cachedResource.timestamp)
            
            switch state {
            case .fresh:
                logger.debug("🟢 Fresh cache hit for: \(urlString)")

                return (cachedResource.data, .fresh, cachedResource.mimeType)
                
            case .stale:
                logger.debug("🟡 Stale cache hit for: \(urlString), triggering revalidation")

                // Trigger background revalidation
                Task {
                    await revalidateResource(request: request)
                }
                return (cachedResource.data, .stale, cachedResource.mimeType)
                
            case .expired:
                logger.debug("🔴 Cache expired for: \(urlString)")
                return (nil, .expired, nil)
            }
        }
        
        // Check URL cache if not in memory
        if let cachedResponse = session.configuration.urlCache?.cachedResponse(for: request),
           let httpResponse = cachedResponse.response as? HTTPURLResponse {
            let resource = CachedResource(
                data: cachedResponse.data,
                timestamp: Date(), // Reset timestamp as we don't know original
                mimeType: httpResponse.mimeType ?? "application/octet-stream",
                response: httpResponse
            )
            resourceCache[urlString] = resource
            return (cachedResponse.data, .fresh, resource.mimeType)
        }
        logger.debug("❌ Cache miss for: \(urlString)")
        return (nil, .expired, nil)
    }
    
    private func revalidateResource(request: URLRequest) async {
        logger.debug("🔄 Starting revalidation for: \(request.url?.absoluteString ?? "")")

        do {
            let (data, response) = try await session.data(for: request)
            
            if let httpResponse = response as? HTTPURLResponse,
               isCacheableResponse(httpResponse) {
                storeCachedResponse(httpResponse, data: data, for: request)
                logger.info("Resource revalidated: \(request.url?.absoluteString ?? "")")
            }
        } catch {
            logger.error("Revalidation failed: \(error.localizedDescription)")
        }
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
        let (cachedData, cacheState, _) = await getCachedResource(for: request)
        if let cachedData = cachedData, cacheState != .expired {
            return cachedData
        }
        
        // Load from network
        do {
            let (data, response) = try await session.data(for: request)
            
            if let httpResponse = response as? HTTPURLResponse,
               isCacheableResponse(httpResponse) {
                storeCachedResponse(httpResponse, data: data, for: request)
            }
            
            return data
        } catch {
            logger.error("Failed to load resource: \(error.localizedDescription)")
            throw error
        }
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
