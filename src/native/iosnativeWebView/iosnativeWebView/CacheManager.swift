import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "CacheManager")

class CacheManager {
    static let shared = CacheManager()
    private let queue = DispatchQueue(label: "com.app.cachemanager", attributes: .concurrent)
    
    enum CacheState {
        case fresh      // Content is within fresh window
        case stale     // Content is in stale-while-revalidate window
        case expired   // Content is expired
    }
    
    private struct CachePolicy {
        static let freshWindow: TimeInterval = CatalystConstants.Cache.freshWindow
        static let staleWindow: TimeInterval = CatalystConstants.Cache.staleWindow
    }

    private let memoryCapacity = CatalystConstants.Cache.memoryCapacity
    private let diskCapacity = CatalystConstants.Cache.diskCapacity
    private let session: URLSession
    private var resourceCache: [String: CachedResource] = [:]
    private let cacheDirectory: URL
    private let compiledCachePatterns: [NSRegularExpression]
    
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

        // Pre-compile regex patterns for better performance
        self.compiledCachePatterns = ConfigConstants.cachePattern.compactMap { pattern in
            do {
                return try NSRegularExpression(
                    pattern: pattern.replacingOccurrences(of: "*", with: ".*"),
                    options: .caseInsensitive
                )
            } catch {
                logger.error("Failed to compile cache pattern '\(pattern)': \(error)")
                return nil
            }
        }

        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.urlCache = URLCache(
            memoryCapacity: memoryCapacity,
            diskCapacity: diskCapacity,
            directory: cacheDirectory
        )
        
        session = URLSession(configuration: configuration)
        logger.info("Cache initialized at: \(self.cacheDirectory.path)")
        
        loadCacheFromDisk()
    }
    
    private func loadCacheFromDisk() {
        queue.async {
            do {
                let fileManager = FileManager.default
                let files = try fileManager.contentsOfDirectory(
                    at: self.cacheDirectory,
                    includingPropertiesForKeys: nil
                ).filter { $0.pathExtension == "cache" }
                
                for file in files {
                    do {
                        let data = try Data(contentsOf: file)
                        if let resource = try? JSONDecoder().decode(CachedResource.self, from: data) {
                            self.resourceCache[resource.urlString] = resource
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

        // Use pre-compiled regex patterns for better performance
        for regex in compiledCachePatterns {
            let range = NSRange(urlString.startIndex..., in: urlString)
            if regex.firstMatch(in: urlString, options: [], range: range) != nil {
                return true
            }
        }

        return false
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
        return await withCheckedContinuation { continuation in
            queue.async {
                guard let urlString = request.url?.absoluteString else {
                    continuation.resume(returning: (nil, .expired, nil))
                    return
                }
                
                if let cachedResource = self.resourceCache[urlString] {
                    let state = self.getCacheState(for: cachedResource.timestamp)
                    
                    switch state {
                    case .fresh:
                        logger.info("🟢 Fresh cache hit for: \(urlString)")
                        continuation.resume(returning: (cachedResource.data, .fresh, cachedResource.mimeType))
                        
                    case .stale:
                        logger.info("🟡 Stale cache hit for: \(urlString)")
                        Task {
                            await self.revalidateResource(request: request)
                        }
                        continuation.resume(returning: (cachedResource.data, .stale, cachedResource.mimeType))
                        
                    case .expired:
                        logger.info("🔴 Cache expired for: \(urlString)")
                        continuation.resume(returning: (nil, .expired, nil))
                    }
                } else {
                    logger.info("❌ Cache miss for: \(urlString)")
                    continuation.resume(returning: (nil, .expired, nil))
                }
            }
        }
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
        queue.async(flags: .barrier) {
            guard let url = request.url else { return }
            
            let resource = CachedResource(
                data: data,
                timestamp: Date(),
                mimeType: response.mimeType ?? "application/octet-stream",
                urlString: url.absoluteString
            )
            
            self.resourceCache[url.absoluteString] = resource
            
            let cachedResponse = CachedURLResponse(
                response: response,
                data: data,
                userInfo: nil,
                storagePolicy: .allowed
            )
            self.session.configuration.urlCache?.storeCachedResponse(cachedResponse, for: request)
            
            let cacheFile = self.getCacheFilePath(for: url)
            do {
                let encodedData = try JSONEncoder().encode(resource)
                try encodedData.write(to: cacheFile)
                logger.info("Resource cached: \(url.absoluteString)")
            } catch {
                logger.error("Failed to write cache to disk: \(error.localizedDescription)")
            }
        }
    }
    
    func clearCache() {
        queue.async(flags: .barrier) {
            self.resourceCache.removeAll()
            self.session.configuration.urlCache?.removeAllCachedResponses()
            
            try? FileManager.default.removeItem(at: self.cacheDirectory)
            try? FileManager.default.createDirectory(
                at: self.cacheDirectory,
                withIntermediateDirectories: true,
                attributes: nil
            )
            
            logger.info("All caches cleared")
        }
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
        // URLCache methods are thread-safe, no need for sync queue
        let memoryUsed = session.configuration.urlCache?.currentMemoryUsage ?? 0
        let diskUsed = session.configuration.urlCache?.currentDiskUsage ?? 0
        return (memoryUsed, diskUsed)
    }
}
