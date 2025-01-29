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
        logger.info("🏗️ [\(ThreadHelper.currentThreadInfo())] Initializing CacheManager")
        
        let baseDirectory = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0]
        
        self.cacheDirectory = baseDirectory.appendingPathComponent("WebCache", isDirectory: true)
        
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
        logger.info("✅ [\(ThreadHelper.currentThreadInfo())] Cache initialized at: \(self.cacheDirectory.path)")
        
        Task {
            await loadCacheFromDisk()
        }
    }
    
    private func loadCacheFromDisk() {
        logger.info("📂 [\(ThreadHelper.currentThreadInfo())] Loading cache from disk")
        do {
            let fileManager = FileManager.default
            let files = try fileManager.contentsOfDirectory(
                at: cacheDirectory,
                includingPropertiesForKeys: nil
            ).filter { $0.pathExtension == "cache" }
            
            logger.info("📚 [\(ThreadHelper.currentThreadInfo())] Found \(files.count) cached files")
            
            for file in files {
                do {
                    let data = try Data(contentsOf: file)
                    if let resource = try? JSONDecoder().decode(CachedResource.self, from: data) {
                        resourceCache[resource.urlString] = resource
                        logger.info("📥 [\(ThreadHelper.currentThreadInfo())] Loaded cache for: \(resource.urlString)")
                    }
                } catch {
                    logger.error("❌ [\(ThreadHelper.currentThreadInfo())] Failed to load cached file: \(error.localizedDescription)")
                }
            }
            
            logger.info("✅ [\(ThreadHelper.currentThreadInfo())] Loaded \(self.resourceCache.count) resources from disk cache")
        } catch {
            logger.error("❌ [\(ThreadHelper.currentThreadInfo())] Failed to load cache from disk: \(error.localizedDescription)")
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
        logger.info("🔍 [\(ThreadHelper.currentThreadInfo())] Checking cache eligibility for: \(url.absoluteString)")
        let urlString = url.absoluteString
        let shouldCache = ConfigConstants.cachePattern.contains { pattern in
            guard let regex = try? NSRegularExpression(
                pattern: pattern.replacingOccurrences(of: "*", with: ".*"),
                options: .caseInsensitive
            ) else {
                return false
            }
            
            let range = NSRange(urlString.startIndex..., in: urlString)
            return regex.firstMatch(in: urlString, options: [], range: range) != nil
        }
        
        logger.info("📋 [\(ThreadHelper.currentThreadInfo())] Cache decision for \(url.absoluteString): \(shouldCache)")
        return shouldCache
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
            logger.error("❌ [\(ThreadHelper.currentThreadInfo())] No URL in request")
            return (nil, .expired, nil)
        }
        
        if let cachedResource = resourceCache[urlString] {
            let state = getCacheState(for: cachedResource.timestamp)
            
            switch state {
            case .fresh:
                logger.info("🟢 [\(ThreadHelper.currentThreadInfo())] Fresh cache hit: \(urlString)")
                return (cachedResource.data, .fresh, cachedResource.mimeType)
                
            case .stale:
                logger.info("🟡 [\(ThreadHelper.currentThreadInfo())] Stale cache hit: \(urlString)")
                Task {
                    await revalidateResource(request: request)
                }
                return (cachedResource.data, .stale, cachedResource.mimeType)
                
            case .expired:
                logger.info("🔴 [\(ThreadHelper.currentThreadInfo())] Cache expired: \(urlString)")
                return (nil, .expired, nil)
            }
        }
        
        logger.info("❌ [\(ThreadHelper.currentThreadInfo())] Cache miss: \(urlString)")
        return (nil, .expired, nil)
    }
    
    private func revalidateResource(request: URLRequest) async {
        logger.info("🔄 [\(ThreadHelper.currentThreadInfo())] Revalidating: \(request.url?.absoluteString ?? "")")
        
        do {
            let (data, response) = try await session.data(for: request)
            
            if let httpResponse = response as? HTTPURLResponse,
               isCacheableResponse(httpResponse) {
                await storeCachedResponse(httpResponse, data: data, for: request)
                logger.info("✅ [\(ThreadHelper.currentThreadInfo())] Resource revalidated successfully")
            }
        } catch {
            logger.error("❌ [\(ThreadHelper.currentThreadInfo())] Revalidation failed: \(error.localizedDescription)")
        }
    }
    
    func storeCachedResponse(_ response: HTTPURLResponse, data: Data, for request: URLRequest) {
        guard let url = request.url else { return }
        
        logger.info("💾 [\(ThreadHelper.currentThreadInfo())] Storing cached response for: \(url.absoluteString)")
        
        let resource = CachedResource(
            data: data,
            timestamp: Date(),
            mimeType: response.mimeType ?? "application/octet-stream",
            urlString: url.absoluteString
        )
        
        resourceCache[url.absoluteString] = resource
        
        let cachedResponse = CachedURLResponse(
            response: response,
            data: data,
            userInfo: nil,
            storagePolicy: .allowed
        )
        session.configuration.urlCache?.storeCachedResponse(cachedResponse, for: request)
        
        Task.detached(priority: .background) {
            let cacheFile = await self.getCacheFilePath(for: url)
            do {
                let encodedData = try JSONEncoder().encode(resource)
                try encodedData.write(to: cacheFile)
                logger.info("✅ [\(ThreadHelper.currentThreadInfo())] Resource cached successfully")
            } catch {
                logger.error("❌ [\(ThreadHelper.currentThreadInfo())] Failed to write cache: \(error.localizedDescription)")
            }
        }
    }
    
    func clearCache() {
        logger.info("🧹 [\(ThreadHelper.currentThreadInfo())] Clearing all caches")
        resourceCache.removeAll()
        session.configuration.urlCache?.removeAllCachedResponses()
        
        Task.detached(priority: .background) {
            try? FileManager.default.removeItem(at: self.cacheDirectory)
            try? FileManager.default.createDirectory(
                at: self.cacheDirectory,
                withIntermediateDirectories: true,
                attributes: nil
            )
            logger.info("✅ [\(ThreadHelper.currentThreadInfo())] Cache cleared successfully")
        }
    }
    
    func createCacheableRequest(from url: URL) -> URLRequest {
        logger.info("📝 [\(ThreadHelper.currentThreadInfo())] Creating cacheable request for: \(url.absoluteString)")
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        return request
    }
    
    func isCacheableResponse(_ response: HTTPURLResponse) -> Bool {
        guard let url = response.url else { return false }
        let isCacheable = (200...299 ~= response.statusCode) && shouldCacheURL(url)
        logger.info("🔍 [\(ThreadHelper.currentThreadInfo())] Response cacheable check: \(isCacheable) for \(url.absoluteString)")
        return isCacheable
    }
    
    func getCacheStatistics() async -> (memoryUsed: Int, diskUsed: Int) {
        let stats = (
            session.configuration.urlCache?.currentMemoryUsage ?? 0,
            session.configuration.urlCache?.currentDiskUsage ?? 0
        )
        logger.info("📊 [\(ThreadHelper.currentThreadInfo())] Cache stats - Memory: \(stats.0)B, Disk: \(stats.1)B")
        return stats
    }
}
