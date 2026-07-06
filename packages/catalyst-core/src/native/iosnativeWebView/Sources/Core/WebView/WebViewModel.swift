import Foundation
import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "WebViewModel")

@MainActor
public class WebViewModel: ObservableObject {
    @Published public var isLoading: Bool = true  // Start as true for initial load
    @Published public var canGoBack: Bool = false
    @Published public var loadingProgress: Double = 0.0
    @Published public var lastLoadedURL: URL?
    @Published public var isLoadingFromCache: Bool = false

    // Safe area insets
    @Published public var safeAreaInsets: SafeAreaInsets = .zero

    public var navigationHistory: [String] = []

    // UserDefaults keys for caching safe area insets
    private let safeAreaTopKey = "safe_area_top"
    private let safeAreaRightKey = "safe_area_right"
    private let safeAreaBottomKey = "safe_area_bottom"
    private let safeAreaLeftKey = "safe_area_left"
    private let safeAreaCachedKey = "safe_area_cached"

    // Callback for safe area updates (set by NativeBridge)
    public var onSafeAreaUpdate: ((SafeAreaInsets) -> Void)?

    public init() {
        // Load cached safe area insets on initialization
        if let cached = loadCachedSafeAreaInsets() {
            self.safeAreaInsets = cached
            #if DEBUG
            logger.info("✅ Loaded cached safe area insets: \(cached)")
            #endif
        } else {
            #if DEBUG
            logger.info("🆕 No cached safe area insets found, using zero")
            #endif
        }
    }
    
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

    // MARK: - Safe Area Methods

    /// Load cached safe area insets from UserDefaults
    /// Returns nil if no cache exists or cache is invalid (all zeros)
    private func loadCachedSafeAreaInsets() -> SafeAreaInsets? {
        let defaults = UserDefaults.standard

        // Check if cache flag is set
        guard defaults.bool(forKey: safeAreaCachedKey) else {
            return nil
        }

        let top = CGFloat(defaults.double(forKey: safeAreaTopKey))
        let right = CGFloat(defaults.double(forKey: safeAreaRightKey))
        let bottom = CGFloat(defaults.double(forKey: safeAreaBottomKey))
        let left = CGFloat(defaults.double(forKey: safeAreaLeftKey))

        let insets = SafeAreaInsets(top: top, right: right, bottom: bottom, left: left)

        // Don't use cached zeros (indicates incomplete initialization)
        if insets.isZero {
            #if DEBUG
            logger.debug("⚠️ Cached insets are zero, ignoring cache")
            #endif
            return nil
        }

        return insets
    }

    /// Save safe area insets to UserDefaults cache
    /// Only caches non-zero values to prevent stale initialization
    private func saveSafeAreaInsetsToCache(_ insets: SafeAreaInsets) {
        // Don't cache zeros
        guard !insets.isZero else {
            #if DEBUG
            logger.debug("⚠️ Skipping cache save for zero insets")
            #endif
            return
        }

        let defaults = UserDefaults.standard
        defaults.set(Double(insets.top), forKey: safeAreaTopKey)
        defaults.set(Double(insets.right), forKey: safeAreaRightKey)
        defaults.set(Double(insets.bottom), forKey: safeAreaBottomKey)
        defaults.set(Double(insets.left), forKey: safeAreaLeftKey)
        defaults.set(true, forKey: safeAreaCachedKey)

        // Force synchronous write (like Android's commit())
        defaults.synchronize()

        #if DEBUG
        logger.info("💾 Cached safe area insets: \(insets)")
        #endif
    }

    /// Calculate safe area insets from the current window
    /// This should be called after the window is fully laid out
    public func calculateSafeAreaInsets() {
        let edgeToEdgeEnabled = ConfigConstants.EdgeToEdge.enabled
        let newInsets = SafeAreaUtils.getSafeAreaInsetsFromKeyWindow(edgeToEdgeEnabled: edgeToEdgeEnabled)

        #if DEBUG
        logger.debug("📐 Calculated safe area insets: \(newInsets)")
        logger.debug("📐 Previous safe area insets: \(self.safeAreaInsets)")
        #endif

        // Check if insets changed
        if newInsets != self.safeAreaInsets {
            self.safeAreaInsets = newInsets

            // Save to cache if non-zero
            if !newInsets.isZero {
                saveSafeAreaInsetsToCache(newInsets)
            }

            // Notify bridge/WebView of update
            onSafeAreaUpdate?(newInsets)

            #if DEBUG
            logger.info("🔄 Safe area insets updated: \(newInsets)")
            #endif
        } else {
            #if DEBUG
            logger.debug("✅ Safe area insets unchanged, no update needed")
            #endif
        }
    }

    /// Setup safe area handling - called when WebView is ready
    /// Performs immediate calculation and schedules deferred verification
    public func setupSafeAreaHandling() {
        // Immediate calculation (may not be accurate yet)
        calculateSafeAreaInsets()

        // Deferred calculation after layout is complete
        // Similar to Android's rootView.post {}
        DispatchQueue.main.async { [weak self] in
            self?.calculateSafeAreaInsets()
        }
    }

    /// Get current safe area headers for HTTP requests
    public func getSafeAreaHeaders() -> [String: String] {
        return safeAreaInsets.toHeaders()
    }
}
