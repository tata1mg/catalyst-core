import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewModel")

@MainActor
class WebViewModel: ObservableObject {
    @Published var isLoading: Bool = true  // Start as true for initial load
    @Published var canGoBack: Bool = false
    @Published var loadingProgress: Double = 0.0
    @Published var lastLoadedURL: URL?
    @Published var isLoadingFromCache: Bool = false
    
    var navigationHistory: [String] = []
    
    func setLoading(_ loading: Bool, fromCache: Bool = false) {
        isLoading = loading
        isLoadingFromCache = fromCache
        
        if !loading {
            loadingProgress = 1.0
            // Reset loading state after a short delay
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
                self.isLoading = false
                self.loadingProgress = 0.0
                self.isLoadingFromCache = false
            }
        }
        
        logger.info("Loading state changed: loading=\(loading), fromCache=\(fromCache)")
    }
    
    func setProgress(_ progress: Double) {
        loadingProgress = progress
    }
    
    func addToHistory(_ urlString: String) {
        navigationHistory.append(urlString)
    }
    
    func reset() {
        isLoading = false
        loadingProgress = 0
        isLoadingFromCache = false
    }
}
