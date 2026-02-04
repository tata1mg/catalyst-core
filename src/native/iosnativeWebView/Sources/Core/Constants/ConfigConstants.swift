// ConfigConstants.swift
// Auto-generated stub - DO NOT EDIT MANUALLY
// This file will be overwritten during build with actual configuration values
import Foundation
#if canImport(UIKit)
import UIKit
#endif

public enum ConfigConstants {
    // Default URL - will be replaced during build
    public static let url = "http://localhost:3000"

    public enum AccessControl {
        public static let allowedUrls: [String] = []
        public static let enabled = false
    }

    public static let appInfo = "test-build"
    public static let cachePattern: [String] = []
    public static let LOCAL_IP = "localhost"
    public static let port = ""

    public enum SplashScreen {
        public static let imageHeight = 200
        public static let imageWidth = 400
    }

    public static let useHttps = false

    // iOS-specific configuration
    public static let appBundleId = "com.example.app"
    public static let appName = "Test App"
    public static let buildType = "debug"
    public static let simulatorName = "test"
    public static let accessControlEnabled = false
    public static let allowedUrls: [String] = []

    // Splash Screen Configuration
    public static let splashScreenEnabled = false
    public static let splashScreenDuration: TimeInterval? = nil
    public static let splashScreenBackgroundColor = "#ffffff"

    #if canImport(UIKit)
    public static let splashScreenImageWidth: CGFloat = 400
    public static let splashScreenImageHeight: CGFloat = 200
    public static let splashScreenCornerRadius: CGFloat = 20
    #else
    // For non-UIKit environments (like swift test on macOS)
    public static let splashScreenImageWidth: Double = 400
    public static let splashScreenImageHeight: Double = 200
    public static let splashScreenCornerRadius: Double = 20
    #endif

    public enum Notifications {
        public static let enabled = false
    }
}
