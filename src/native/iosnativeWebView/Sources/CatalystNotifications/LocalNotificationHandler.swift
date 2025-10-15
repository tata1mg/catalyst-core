import Foundation
import UserNotifications
import UIKit
import os
import CatalystCore

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "LocalNotificationHandler")

class LocalNotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    var onNotificationReceived: ((String, [String: Any]) -> Void)?
    var onDeepLinkRequested: ((URL) -> Void)?
    private var baseURL: String

    init(baseURL: String) {
        self.baseURL = baseURL
        super.init()
    }

    func updateBaseURL(_ baseURL: String) {
        self.baseURL = baseURL
    }

    // MARK: - Notification Creation

    func createNotificationRequest(_ config: NotificationConfig, identifier: String) async -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = config.title
        content.body = config.body

        // Set badge
        if let badge = config.badge {
            content.badge = NSNumber(value: badge)
        }

        // Set channel-based sound and priority
        let channel = NotificationChannelManager.getChannelConfig(config.channel)
        content.sound = channel.sound

        // Store notification data for deep linking
        if let data = config.data {
            let dataDict = data.mapValues { $0.value }
            content.userInfo = [
                "notificationData": dataDict,
                "channel": config.channel,
                "autoCancel": config.autoCancel
            ]
        }

        // Apply notification style
        await applyNotificationStyle(content, config: config)

        // Create trigger (immediate for now, can be extended for scheduled notifications)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)

        return UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
    }

    // MARK: - Style Application

    private func applyNotificationStyle(_ content: UNMutableNotificationContent, config: NotificationConfig) async {
        let style = NotificationStyle(rawValue: config.style) ?? .basic

        switch style {
        case .basic:
            await applyBasicStyle(content, config: config)
        case .bigText:
            await applyBigTextStyle(content, config: config)
        case .bigImage:
            await applyBigImageStyle(content, config: config)
        case .actionButtons:
            await applyActionButtonsStyle(content, config: config)
        }
    }

    private func applyBasicStyle(_ content: UNMutableNotificationContent, config: NotificationConfig) async {
        // Basic style is already applied with title and body
        content.categoryIdentifier = "DEFAULT"
        logger.debug("Applied BASIC style to notification")
    }

    private func applyBigTextStyle(_ content: UNMutableNotificationContent, config: NotificationConfig) async {
        // iOS doesn't have expandable text notifications like Android
        // We can make the body longer and detailed
        content.subtitle = "Tap to read more"
        content.categoryIdentifier = "DEFAULT"
        logger.debug("Applied BIG_TEXT style to notification")
    }

    private func applyBigImageStyle(_ content: UNMutableNotificationContent, config: NotificationConfig) async {
        content.categoryIdentifier = "DEFAULT"

        // Load large image if provided
        if let largeImageURL = config.largeImage {
            await loadAndAttachImage(content, imageURL: largeImageURL)
        }

        logger.debug("Applied BIG_IMAGE style to notification")
    }

    private func applyActionButtonsStyle(_ content: UNMutableNotificationContent, config: NotificationConfig) async {
        if let actions = config.actions, !actions.isEmpty {
            let categoryId = "ACTION_BUTTONS"
            content.categoryIdentifier = categoryId

            let notificationActions = actions.map { actionConfig in
                UNNotificationAction(
                    identifier: actionConfig.action,
                    title: actionConfig.title,
                    options: []
                )
            }

            let category = UNNotificationCategory(
                identifier: categoryId,
                actions: notificationActions,
                intentIdentifiers: [],
                options: [.customDismissAction]
            )

            // Replace existing ACTION_BUTTONS category
            let center = UNUserNotificationCenter.current()
            let existingCategories = await center.notificationCategories()

            // Remove old ACTION_BUTTONS category and add new one
            var updatedCategories = existingCategories.filter { $0.identifier != categoryId }
            updatedCategories.insert(category)
            center.setNotificationCategories(updatedCategories)

            logger.debug("Applied ACTION_BUTTONS style with \(actions.count) actions")
        } else {
            content.categoryIdentifier = "DEFAULT"
            logger.debug("ACTION_BUTTONS style requested but no actions provided, using DEFAULT")
        }
    }

    // MARK: - Image Loading

    private func loadAndAttachImage(_ content: UNMutableNotificationContent, imageURL: String) async {
        guard let url = URL(string: imageURL) else {
            logger.warning("Invalid image URL: \(imageURL)")
            return
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let tempDir = FileManager.default.temporaryDirectory
            let tempFile = tempDir.appendingPathComponent(UUID().uuidString + ".jpg")

            try data.write(to: tempFile)

            let attachment = try UNNotificationAttachment(
                identifier: UUID().uuidString,
                url: tempFile,
                options: [UNNotificationAttachmentOptionsTypeHintKey: "public.jpeg"]
            )

            content.attachments = [attachment]
            logger.debug("Successfully attached image to notification")
        } catch {
            logger.error("Failed to load notification image: \(error.localizedDescription)")
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {

        let notification = response.notification
        let userInfo = notification.request.content.userInfo

        // Extract notification data
        let notificationData = userInfo["notificationData"] as? [String: Any] ?? [:]
        let autoCancel = userInfo["autoCancel"] as? Bool ?? true

        // Handle action responses
        if response.actionIdentifier != UNNotificationDefaultActionIdentifier {
            // Action button was tapped
            handleActionResponse(response, notificationData: notificationData)
        } else {
            // Regular notification tap
            handleNotificationTap(notificationData: notificationData)
        }

        // Auto-cancel if enabled (remove from notification center)
        if autoCancel {
            center.removeDeliveredNotifications(withIdentifiers: [notification.request.identifier])
        }

        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {

        // Show notification even when app is in foreground
        let options: UNNotificationPresentationOptions = [.banner, .sound, .badge]
        completionHandler(options)

        // Notify JavaScript about received notification
        let userInfo = notification.request.content.userInfo
        let notificationData = userInfo["notificationData"] as? [String: Any] ?? [:]

        onNotificationReceived?("NOTIFICATION_RECEIVED", [
            "title": notification.request.content.title,
            "body": notification.request.content.body,
            "data": notificationData,
            "foreground": true
        ])
    }

    // MARK: - Response Handling

    private func handleActionResponse(_ response: UNNotificationResponse, notificationData: [String: Any]) {
        let actionId = response.actionIdentifier

        logger.info("Action button tapped: \(actionId)")

        // Build notification URL with action
        let notificationURL = buildNotificationUrl(baseURL: baseURL, action: actionId, data: notificationData)

        // Notify JavaScript about action
        onNotificationReceived?("NOTIFICATION_ACTION_PERFORMED", [
            "action": actionId,
            "data": notificationData,
            "deepLinkURL": notificationURL
        ])

        // Navigate to notification endpoint
        if let url = URL(string: notificationURL) {
            onDeepLinkRequested?(url)
        }
    }

    private func handleNotificationTap(notificationData: [String: Any]) {
        logger.info("Notification tapped")

        // Build notification URL
        let notificationURL = buildNotificationUrl(baseURL: baseURL, action: nil, data: notificationData)

        // Notify JavaScript about tap
        onNotificationReceived?("NOTIFICATION_TAPPED", [
            "data": notificationData,
            "deepLinkURL": notificationURL
        ])

        // Navigate to notification endpoint
        if let url = URL(string: notificationURL) {
            onDeepLinkRequested?(url)
        }
    }

    // MARK: - Notification URL Building

    private func buildNotificationUrl(baseURL: String, action: String?, data: [String: Any]) -> String {
        var url = "\(baseURL)/notification"
        var params: [String] = []

        // Add action if present
        if let action = action {
            let encodedAction = action.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? action
            params.append("action=\(encodedAction)")
        }

        // Add data if present
        if !data.isEmpty {
            do {
                let jsonData = try JSONSerialization.data(withJSONObject: data, options: [])
                if let jsonString = String(data: jsonData, encoding: .utf8) {
                    let encodedData = jsonString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                    params.append("data=\(encodedData)")
                }
            } catch {
                logger.error("Failed to serialize notification data: \(error.localizedDescription)")
            }
        }

        if !params.isEmpty {
            url += "?" + params.joined(separator: "&")
        }

        return url
    }

}