//
//  NotificationHandlerProtocol.swift
//  CatalystCore
//
//  Protocol for notification functionality - allows optional notification feature
//

import Foundation

/// Protocol defining notification handler interface
/// Implemented by NotificationManager when notifications are enabled,
/// or by NullNotificationHandler when disabled
public protocol NotificationHandlerProtocol {
    // MARK: - Permission Management
    func requestPermission() async -> Bool

    // MARK: - Local Notifications
    @discardableResult
    func scheduleLocal(_ config: NotificationConfig) -> String
    func cancelLocal(_ notificationId: String) -> Bool
    func cancelAllLocal()

    // MARK: - Push Notifications
    func initializePush() async -> String?
    func subscribeToTopic(_ topic: String) async -> Bool
    func unsubscribeFromTopic(_ topic: String) async -> Bool
    func getSubscribedTopics() async -> [String]

    // MARK: - Badge Management
    func updateBadge(_ count: Int)

    // MARK: - Navigation
    func setNavigationHandler(_ handler: @escaping (URL) -> Void)
}
