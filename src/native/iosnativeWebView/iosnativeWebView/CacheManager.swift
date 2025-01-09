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
    private let session: URLSession
    private var resourceCache: [String: CachedResource] = [:]
    private let cacheDirectory: URL
    
    private struct CachedResource: Codable {
        let data: Data
        let timestamp: Date
        let mimeType: String
        let urlString: String
        
        var response: HTTPURLResponse? {
            guard let url = URL(string: urlString) else { return nil }
            return HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": mimeType]
            )
        }
    }
    
    private init() {
        // Get the cache directory in the Application Support directory
        let baseDirectory = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0]
        
        self.cacheDirectory = baseDirectory.appendingPathComponent("WebCache", isDirectory: true)
        
        // Create cache directory if it doesn't exist
        try? FileManager.default.createDirectory(
            at: cacheDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.urlCache = URLCache(
            memoryCapacity: memoryCapacity,
            diskCapacity: diskCapacity,
            directory: cacheDirectory
        )
        
        session = URLSession(configuration: configuration)
        logger.info("Cache initialized with resource caching support at: \(self.cacheDirectory.path)")
        
        // Load existing cache from disk
        Task {
            await loadCacheFromDisk()
        }
    }
    
    private func loadCacheFromDisk() {
        do {
            let fileManager = FileManager.default
            let files = try fileManager.contentsOfDirectory(
                at: cacheDirectory,
                includingPropertiesForKeys: nil
            ).filter { $0.pathExtension == "cache" }
            
            for file in files {
                do {
                    let data = try Data(contentsOf: file)
                    if let resource = try? JSONDecoder().decode(CachedResource.self, from: data) {
                        resourceCache[resource.urlString] = resource
                    }
                } catch {
                    logger.error("Failed to load cached file: \(error.localizedDescription)")
                }
            }
            
            logger.info("Loaded \(self.resourceCache.count) resources from disk cache")
        } catch {
            logger.error("Failed to load cache from disk: \(error.localizedDescription)")
        }
    }
    
    private func getCacheKey(for url: URL) -> String {
        return url.absoluteString.replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
    }
    
    private func getCacheFilePath(for url: URL) -> URL {
        return cacheDirectory.appendingPathComponent(getCacheKey(for: url))
            .appendingPathExtension("cache")
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
        guard let urlString = request.url?.absoluteString else {
            return (nil, .expired, nil)
        }
        
        // Check in-memory cache first
        if let cachedResource = resourceCache[urlString] {
            let state = getCacheState(for: cachedResource.timestamp)
            
            switch state {
            case .fresh:
                logger.info("🟢 Fresh cache hit for: \(urlString)")
                return (cachedResource.data, .fresh, cachedResource.mimeType)
                
            case .stale:
                logger.info("🟡 Stale cache hit for: \(urlString), triggering revalidation")
                Task {
                    await revalidateResource(request: request)
                }
                return (cachedResource.data, .stale, cachedResource.mimeType)
                
            case .expired:
                logger.info("🔴 Cache expired for: \(urlString)")
                return (nil, .expired, nil)
            }
        }
        
        logger.info("❌ Cache miss for: \(urlString)")
        return (nil, .expired, nil)
    }
    
    private func revalidateResource(request: URLRequest) async {
        logger.info("🔄 Starting revalidation for: \(request.url?.absoluteString ?? "")")
        
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
        guard let url = request.url else { return }
        
        let resource = CachedResource(
            data: data,
            timestamp: Date(),
            mimeType: response.mimeType ?? "application/octet-stream",
            urlString: url.absoluteString
        )
        
        // Store in memory cache
        resourceCache[url.absoluteString] = resource
        
        // Store in URL cache
        let cachedResponse = CachedURLResponse(
            response: response,
            data: data,
            userInfo: nil,
            storagePolicy: .allowed
        )
        session.configuration.urlCache?.storeCachedResponse(cachedResponse, for: request)
        
        // Store to disk
        let cacheFile = getCacheFilePath(for: url)
        do {
            let encodedData = try JSONEncoder().encode(resource)
            try encodedData.write(to: cacheFile)
            logger.info("Resource cached: \(url.absoluteString)")
        } catch {
            logger.error("Failed to write cache to disk: \(error.localizedDescription)")
        }
    }
    
    func clearCache() {
        resourceCache.removeAll()
        session.configuration.urlCache?.removeAllCachedResponses()
        
        // Clear cache directory
        try? FileManager.default.removeItem(at: cacheDirectory)
        try? FileManager.default.createDirectory(
            at: cacheDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        
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
