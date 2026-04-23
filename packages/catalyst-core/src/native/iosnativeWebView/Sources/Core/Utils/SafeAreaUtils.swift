//
//  SafeAreaUtils.swift
//  iosnativeWebView
//
//  Safe area inset calculation utilities for iOS
//  Equivalent to Android's SafeAreaUtils.kt
//

import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "SafeAreaUtils")

// MARK: - SafeAreaInsets Data Structure

/// Represents safe area insets for all edges of the screen
/// Matches Android's SafeAreaInsets data class
public struct SafeAreaInsets: Codable, Equatable, CustomStringConvertible {
    public let top: CGFloat
    public let right: CGFloat
    public let bottom: CGFloat
    public let left: CGFloat

    /// Zero insets (no safe area)
    public static let zero = SafeAreaInsets(top: 0, right: 0, bottom: 0, left: 0)

    /// Public initializer
    public init(top: CGFloat, right: CGFloat, bottom: CGFloat, left: CGFloat) {
        self.top = top
        self.right = right
        self.bottom = bottom
        self.left = left
    }

    /// Convert to dictionary for JSON serialization
    public func toDict() -> [String: Any] {
        return [
            "top": Int(top),
            "right": Int(right),
            "bottom": Int(bottom),
            "left": Int(left)
        ]
    }

    /// Convert to header dictionary for HTTP requests
    public func toHeaders() -> [String: String] {
        return [
            "X-Safe-Area-Top": String(Int(top)),
            "X-Safe-Area-Right": String(Int(right)),
            "X-Safe-Area-Bottom": String(Int(bottom)),
            "X-Safe-Area-Left": String(Int(left)),
            // Prevent caching of SSR response so updated headers are always used
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache"
        ]
    }

    /// Check if all insets are zero
    public var isZero: Bool {
        return top == 0 && right == 0 && bottom == 0 && left == 0
    }

    /// String representation for logging and debugging
    public var description: String {
        return "SafeAreaInsets(top: \(Int(top)), right: \(Int(right)), bottom: \(Int(bottom)), left: \(Int(left)))"
    }
}

// MARK: - SafeAreaUtils

public class SafeAreaUtils {
    public static func getSafeAreaInsets(from window: UIWindow?, edgeToEdgeEnabled: Bool) -> SafeAreaInsets {
        guard let window = window else {
            #if DEBUG
            logger.debug("⚠️ No window available, returning zero insets")
            #endif
            return .zero
        }

        // If edge-to-edge is disabled, SwiftUI is already respecting safe areas
        // The system handles padding automatically, so return zero
        // (app doesn't need to apply manual padding)
        guard edgeToEdgeEnabled else {
            #if DEBUG
            logger.debug("🎨 Edge-to-edge disabled - SwiftUI respects safe areas, returning zero")
            #endif
            return .zero
        }

        // Edge-to-edge enabled: Content draws behind system UI
        // Return actual insets so the app can apply padding manually
        let safeArea = window.safeAreaInsets

        #if DEBUG
        logger.debug("📐 Window safe area insets - top: \(safeArea.top), right: \(safeArea.right), bottom: \(safeArea.bottom), left: \(safeArea.left)")
        logger.debug("🎨 Edge-to-edge enabled - returning insets for manual padding")
        #endif

        // On iOS, safeAreaInsets already includes:
        // - Status bar
        // - Home indicator
        // - Notch/Dynamic Island
        // - Any other screen intrusions
        //
        // Unlike Android, we don't need to manually combine system bars and cutouts

        let insets = SafeAreaInsets(
            top: max(0, safeArea.top),
            right: max(0, safeArea.right),
            bottom: max(0, safeArea.bottom),
            left: max(0, safeArea.left)
        )

        #if DEBUG
        logger.debug("✅ Computed safe area insets: \(insets)")
        #endif

        return insets
    }

    /// Get safe area insets from the key window of a scene
    /// Convenience method that finds the active window automatically
    public static func getSafeAreaInsetsFromKeyWindow(edgeToEdgeEnabled: Bool) -> SafeAreaInsets {
        // Get the key window from active scene
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }

        return getSafeAreaInsets(from: window, edgeToEdgeEnabled: edgeToEdgeEnabled)
    }
}
