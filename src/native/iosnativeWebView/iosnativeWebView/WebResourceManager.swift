


import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebResourceManager")

actor WebResourceManager {
    static let shared = WebResourceManager()
    private var activeRequests: [URL: Task<(Data, String?), Error>] = [:]
    private let cacheManager = CacheManager.shared
    
    func loadResource(url: URL, cachePolicy: URLRequest.CachePolicy = .useProtocolCachePolicy) async throws -> (Data, String?) {
        // Cancel existing request for the same URL if any
        activeRequests[url]?.cancel()
        
        let task = Task {
            // Try cache first
            let request = URLRequest(url: url, cachePolicy: cachePolicy)
            let (cachedData, cacheState, mimeType) = await cacheManager.getCachedResource(for: request)
            
            if let data = cachedData, cacheState != .expired {
                logger.info("Using cached resource: \(url.absoluteString)")
                return (data, mimeType)
            }
            
            // Fallback to network request
            logger.info("Fetching resource: \(url.absoluteString)")
            let (data, response) = try await URLSession.shared.data(for: request)
            let httpResponse = response as? HTTPURLResponse
            let responseMimeType = httpResponse?.mimeType
            
            // Cache the response in background
            if let httpResponse = httpResponse,
               await cacheManager.isCacheableResponse(httpResponse) {
                await cacheManager.storeCachedResponse(httpResponse, data: data, for: request)
            }
            
            return (data, responseMimeType)
        }
        
        activeRequests[url] = task
        defer { activeRequests[url] = nil }
        
        return try await task.value
    }
    
    func cancelAllRequests() {
        for (_, task) in activeRequests {
            task.cancel()
        }
        activeRequests.removeAll()
    }
}
