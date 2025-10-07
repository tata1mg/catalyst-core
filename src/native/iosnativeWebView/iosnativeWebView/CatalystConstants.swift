// CatalystConstants.swift
// Unified configuration constants for the iOS native web bridge

import Foundation
import UIKit // For CGFloat

// Centralized configuration used across the project
// Mirrors the Android-side constants to keep behavior consistent
enum CatalystConstants {
    // MARK: - File Transport
    enum FileTransport {
        // Max size to inline over the JS bridge as Base64 (2 MB)
        static let base64SizeLimit: Int64 = 2 * 1024 * 1024
        // Max size supported overall via the framework server (100 MB)
        static let frameworkServerSizeLimit: Int64 = 100 * 1024 * 1024
    }

    // MARK: - Image Processing
    enum ImageProcessing {
        enum Quality {
            static let high: CGFloat = 0.9
            static let medium: CGFloat = 0.7
            static let low: CGFloat = 0.5
        }
        // Default JPEG compression quality
        static let defaultQuality: CGFloat = Quality.medium
    }

    // MARK: - Network Server (Framework Server)
    enum NetworkServer {
        // Port range to probe for starting the local HTTP server
        static let portRangeStart: UInt16 = 18_080
        static let portRangeEnd: UInt16 = 18_110

        // Session/file timeout and cleanup cadence
        static let sessionTimeout: TimeInterval = 10 * 60 // 10 minutes
        static let cleanupInterval: TimeInterval = 60 // 1 minute

        // Connection policies
        static let maxConnections: Int = 16
        static let connectionTimeout: TimeInterval = 30 // seconds
    }

    // MARK: - Error Codes
    enum ErrorCodes {
        static let badRequest = 400
        static let fileNotFound = 404
        static let internalServerError = 500
    }

    // MARK: - Bridge Limits / Validation
    enum Bridge {
        // Safety limit for inbound JS message size (128 KB)
        static let maxMessageSize: Int = 128 * 1024
        // Command execution timeout window
        static let commandTimeout: TimeInterval = 30 // seconds
        // Whitelisted commands the bridge will accept
        static let validCommands: Set<String> = [
            "openCamera",
            "requestCameraPermission",
            "getDeviceInfo",
            "logger",
            "pickFile",
            "openFileWithIntent",
            "requestHapticFeedback",
            // Notification commands
            "requestNotificationPermission",
            "scheduleLocalNotification",
            "cancelLocalNotification",
            "registerForPushNotifications",
            "subscribeToTopic",
            "unsubscribeFromTopic",
            "getSubscribedTopics"
        ]
    }

    // MARK: - Caching
    enum Cache {
        // Fresh/stale windows for SWR behavior
        static let freshWindow: TimeInterval = 60 // seconds
        static let staleWindow: TimeInterval = 5 * 60 // seconds

        // URLCache capacities (bytes)
        static let memoryCapacity: Int = 10 * 1024 * 1024 // 10 MB
        static let diskCapacity: Int = 50 * 1024 * 1024 // 50 MB
    }

    // MARK: - Logging Configuration
    enum Logging {
        enum Categories {
            static let nativeBridge = "NativeBridge"
            static let javascriptInterface = "BridgeJavaScriptInterface"
            static let messageValidator = "BridgeMessageValidator"
            static let commandHandler = "BridgeCommandHandler"
            static let fileHandler = "BridgeFileHandler"
            static let delegateHandler = "BridgeDelegateHandler"
        }
    }
}
