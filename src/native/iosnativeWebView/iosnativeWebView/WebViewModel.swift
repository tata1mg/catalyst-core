import Foundation
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewModel")

@MainActor
class WebViewModel: ObservableObject {
    @Published private(set) var isLoading = false
    @Published private(set) var loadingProgress: Double = 0.0
    @Published private(set) var isLoadingFromCache = false
    @Published private(set) var lastLoadedURL: URL?
    @Published private(set) var canGoBack = false
    @Published private(set) var error: Error?
    
    private var visitedURLs: [String] = []
    
    func setLoading(_ loading: Bool, fromCache: Bool) {
        logger.info("🔄 [\(ThreadHelper.currentThreadInfo())] Setting loading state: loading=\(loading), fromCache=\(fromCache)")
        isLoading = loading
        isLoadingFromCache = fromCache
        
        if !loading {
            loadingProgress = 1.0
        }
    }
    
    func setProgress(_ progress: Double) {
        logger.info("📊 [\(ThreadHelper.currentThreadInfo())] Updating progress: \(Int(progress * 100))%")
        loadingProgress = progress
    }
    
    func setError(_ error: Error?) {
        logger.info("⚠️ [\(ThreadHelper.currentThreadInfo())] Setting error: \(error?.localizedDescription ?? "nil")")
        self.error = error
    }
    
    func setLastLoadedURL(_ url: URL?) {
        logger.info("🔗 [\(ThreadHelper.currentThreadInfo())] Setting last loaded URL: \(url?.absoluteString ?? "nil")")
        self.lastLoadedURL = url
    }
    
    func setCanGoBack(_ canGoBack: Bool) {
        logger.info("◀️ [\(ThreadHelper.currentThreadInfo())] Setting canGoBack: \(canGoBack)")
        self.canGoBack = canGoBack
    }
    
    func addToHistory(_ urlString: String) {
        logger.info("📝 [\(ThreadHelper.currentThreadInfo())] Adding to history: \(urlString)")
        if !visitedURLs.contains(urlString) {
            visitedURLs.append(urlString)
        }
    }
    
    func reset() {
        logger.info("🔄 [\(ThreadHelper.currentThreadInfo())] Resetting view model state")
        isLoading = false
        loadingProgress = 0.0
        isLoadingFromCache = false
        error = nil
    }
}
