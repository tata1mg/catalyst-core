import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewModel")

@MainActor
public class WebViewModel: ObservableObject {
    @Published public var isLoading: Bool = true  // Start as true for initial load
    @Published public var canGoBack: Bool = false
    @Published public var loadingProgress: Double = 0.0
    @Published public var lastLoadedURL: URL?
    @Published public var isLoadingFromCache: Bool = false
    
    public var navigationHistory: [String] = []
    
    public init() {}
    
    public func setLoading(_ loading: Bool, fromCache: Bool = false) {
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
    
    public func setProgress(_ progress: Double) {
        loadingProgress = progress
    }
    
    public func addToHistory(_ urlString: String) {
        navigationHistory.append(urlString)
    }
    
    public func reset() {
        isLoading = false
        loadingProgress = 0
        isLoadingFromCache = false
    }
}
