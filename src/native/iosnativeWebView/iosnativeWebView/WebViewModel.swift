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
        isLoading = loading
        isLoadingFromCache = fromCache
        
        if !loading {
            loadingProgress = 1.0
        }
    }
    
    func setProgress(_ progress: Double) {
        loadingProgress = progress
    }
    
    func setError(_ error: Error?) {
        self.error = error
    }
    
    func setLastLoadedURL(_ url: URL?) {
        self.lastLoadedURL = url
    }
    
    func setCanGoBack(_ canGoBack: Bool) {
        self.canGoBack = canGoBack
    }
    
    func addToHistory(_ urlString: String) {
        if !visitedURLs.contains(urlString) {
            visitedURLs.append(urlString)
        }
    }
    
    func reset() {
        isLoading = false
        loadingProgress = 0.0
        isLoadingFromCache = false
        error = nil
    }
}
