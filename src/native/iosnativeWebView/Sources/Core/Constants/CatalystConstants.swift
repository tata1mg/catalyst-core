// CatalystConstants.swift
// Unified configuration constants for the iOS native web bridge

import Foundation
import UIKit // For CGFloat

// Centralized configuration used across the project
// Mirrors the Android-side constants to keep behavior consistent
public enum CatalystConstants {
    // MARK: - File Transport
    public enum FileTransport {
        // Max size to inline over the JS bridge as Base64 (2 MB)
        public static let base64SizeLimit: Int64 = 2 * 1024 * 1024
        // Max size supported overall via the framework server (100 MB)
        public static let frameworkServerSizeLimit: Int64 = 100 * 1024 * 1024
    }

    // MARK: - Image Processing
    public enum ImageProcessing {
        public enum Quality {
            public static let high: CGFloat = 0.9
            public static let medium: CGFloat = 0.7
            public static let low: CGFloat = 0.5
        }
        // Default JPEG compression quality
        public static let defaultQuality: CGFloat = Quality.medium
    }

    // MARK: - Network Server (Framework Server)
    public enum NetworkServer {
        // Port range to probe for starting the local HTTP server
        public static let portRangeStart: UInt16 = 18_080
        public static let portRangeEnd: UInt16 = 18_110

        // Session/file timeout and cleanup cadence
        public static let sessionTimeout: TimeInterval = 10 * 60 // 10 minutes
        public static let cleanupInterval: TimeInterval = 60 // 1 minute

        // Connection policies
        public static let maxConnections: Int = 16
        public static let connectionTimeout: TimeInterval = 30 // seconds
    }

    // MARK: - Error Codes
    public enum ErrorCodes {
        public static let badRequest = 400
        public static let fileNotFound = 404
        public static let internalServerError = 500
    }

    // MARK: - Bridge Limits / Validation
    public enum Bridge {
        // Safety limit for inbound JS message size (128 KB)
        public static let maxMessageSize: Int = 128 * 1024
        // Command execution timeout window
        public static let commandTimeout: TimeInterval = 30 // seconds
        // Whitelisted commands the bridge will accept
        public static var validCommands: Set<String> {
            var commands: Set<String> = [
                "openCamera",
                "requestCameraPermission",
                "getDeviceInfo",
                "getNetworkStatus",
                "logger",
                "pickFile",
                "openFileWithIntent",
                "requestHapticFeedback",
                "googleSignIn"
                "getSafeArea"
            ]

            // Check if notifications are enabled via config
            // When enabled, CatalystNotifications module will be available at app layer
            if ConfigConstants.Notifications.enabled {
                print("🔔 DEBUG: Notifications enabled in config - adding notification commands")
                commands.formUnion([
                    "requestNotificationPermission",
                    "scheduleLocalNotification",
                    "cancelLocalNotification",
                    "registerForPushNotifications",
                    "subscribeToTopic",
                    "unsubscribeFromTopic",
                    "getSubscribedTopics"
                ])
            } else {
                print("❌ DEBUG: Notifications disabled in config - notification commands not available")
            }

            print("🔐 DEBUG: Google Sign-In enabled in config? \(ConfigConstants.GoogleSignIn.enabled)")

            print("🔧 DEBUG: Valid commands available: \(commands.sorted().joined(separator: ", "))")
            return commands
        }
    }

    // MARK: - Caching
    public enum Cache {
        // Fresh/stale windows for SWR behavior
        public static let freshWindow: TimeInterval = 60 // seconds
        public static let staleWindow: TimeInterval = 5 * 60 // seconds

        // URLCache capacities (bytes)
        public static let memoryCapacity: Int = 10 * 1024 * 1024 // 10 MB
        public static let diskCapacity: Int = 50 * 1024 * 1024 // 50 MB
    }

    // MARK: - Logging Configuration
    public enum Logging {
        public enum Categories {
            public static let nativeBridge = "NativeBridge"
            public static let javascriptInterface = "BridgeJavaScriptInterface"
            public static let messageValidator = "BridgeMessageValidator"
            public static let commandHandler = "BridgeCommandHandler"
            public static let fileHandler = "BridgeFileHandler"
            public static let delegateHandler = "BridgeDelegateHandler"
        }
    }
}
