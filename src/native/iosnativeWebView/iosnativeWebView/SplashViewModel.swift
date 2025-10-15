import Foundation
import SwiftUI
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "SplashViewModel")

@MainActor
class SplashViewModel: ObservableObject {
    @Published var shouldShowSplash: Bool = true
    
    private var startTime = Date()
    private var durationTimer: Timer?
    private var hasWebViewLoaded = false
    
    init() {
        logger.info("SplashViewModel initialized")
        startDurationTimer()
    }
    
    deinit {
        durationTimer?.invalidate()
    }
    
    private func startDurationTimer() {
        // Check if duration-based dismissal is configured
        guard let duration = ConfigConstants.splashScreenDuration else {
            logger.info("No splash screen duration configured, using progress-based dismissal")
            return
        }
        
        logger.info("Starting duration timer for \(duration) seconds")
        
        // Create a timer that fires after the specified duration
        durationTimer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
            DispatchQueue.main.async {
                self?.dismissSplashByDuration()
            }
        }
    }
    
    func updateProgress(_ progress: Double) {
        logger.debug("WebView progress updated: \(progress)")
        
        // Check if duration exists (ConfigConstants.splashScreenDuration is Optional)
        if let duration = ConfigConstants.splashScreenDuration {
            // Duration-based dismissal - check if minimum time has elapsed
            let timeElapsed = Date().timeIntervalSince(startTime)
            
            // Mark that WebView has loaded, but don't dismiss until duration is met
            if progress >= 1.0 {
                hasWebViewLoaded = true
            }
            
            // If both conditions are met (duration elapsed AND WebView loaded), dismiss immediately
            if timeElapsed >= duration && hasWebViewLoaded {
                dismissSplash()
            }
        } else {
            // WebView progress-based dismissal (fallback behavior)
            if progress >= 1.0 {
                dismissSplash()
            }
        }
    }
    
    private func dismissSplashByDuration() {
        dismissSplash()
    }
    
    private func dismissSplash() {
        guard shouldShowSplash else { return }
        
        durationTimer?.invalidate()
        durationTimer = nil
        
        withAnimation(.easeOut(duration: 0.3)) {
            shouldShowSplash = false
        }
    }
    
    // Public method to manually dismiss splash (if needed)
    func forceDismiss() {
        logger.info("Force dismissing splash screen")
        dismissSplash()
    }
}
