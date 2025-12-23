//
//  NullNotificationHandler.swift
//  iosnativeWebView
//
//  Stub implementation of NotificationHandlerProtocol
//  Used when notifications are disabled - does nothing, no Firebase dependency
//

import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NullNotificationHandler")

/// Null implementation of notification handler - does nothing
/// Used when notifications feature is disabled in config
public class NullNotificationHandler: NotificationHandlerProtocol {
    public static let shared = NullNotificationHandler()

    private init() {
        logger.info("NullNotificationHandler initialized - notifications disabled")
    }

    // MARK: - Permission Management

    public func requestPermission() async -> Bool {
        logger.info("Notification permission request ignored (notifications disabled)")
        return false
    }

    // MARK: - Local Notifications

    @discardableResult
    public func scheduleLocal(_ config: NotificationConfig) -> String {
        logger.info("Local notification schedule ignored (notifications disabled)")
        return "null-notification-id"
    }

    public func cancelLocal(_ notificationId: String) -> Bool {
        logger.info("Cancel local notification ignored (notifications disabled)")
        return false
    }

    public func cancelAllLocal() {
        logger.info("Cancel all local notifications ignored (notifications disabled)")
    }

    // MARK: - Push Notifications

    public func initializePush() async -> (token: String?, error: String?) {
        logger.info("Push notification initialization ignored (notifications disabled)")
        return (nil, "Notifications are disabled in configuration")
    }

    public func subscribeToTopic(_ topic: String) async -> Bool {
        logger.info("Topic subscription ignored (notifications disabled): \(topic)")
        return false
    }

    public func unsubscribeFromTopic(_ topic: String) async -> Bool {
        logger.info("Topic unsubscription ignored (notifications disabled): \(topic)")
        return false
    }

    public func getSubscribedTopics() async -> [String] {
        logger.info("Get subscribed topics ignored (notifications disabled)")
        return []
    }

    // MARK: - Badge Management

    public func updateBadge(_ count: Int) {
        logger.info("Badge update ignored (notifications disabled): \(count)")
    }

    // MARK: - Navigation

    public func setNavigationHandler(_ handler: @escaping (URL) -> Void) {
        logger.info("Navigation handler registration ignored (notifications disabled)")
    }
}
