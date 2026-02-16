import Foundation
import UserNotifications
import UIKit
import os
import CatalystCore
import FirebaseCore
import FirebaseMessaging

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NotificationManager")

public final class NotificationManager: ObservableObject, NotificationHandlerProtocol {
    public static let shared = NotificationManager()

    private let localHandler: LocalNotificationHandler
    private let pushHandler: PushNotificationHandler
    private var navigationHandler: ((URL) -> Void)?
    private var baseURL: String = ""


    private init() {
        self.localHandler = LocalNotificationHandler(baseURL: "")
        self.pushHandler = PushNotificationHandler()
    }

    public func initialize(baseURL: String) {
        self.baseURL = baseURL
        self.localHandler.updateBaseURL(baseURL)

        initializeFirebase()
        setupNotificationCenter()
        setupChannels()
    }

    private func initializeFirebase() {
        // Check if Firebase is already configured
        if FirebaseApp.app() != nil {
            logger.warning("Firebase is already configured. Skipping initialization.")
            return
        }

        // Check for GoogleService-Info.plist
        guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
            logger.error("❌ GoogleService-Info.plist not found. Firebase initialization skipped to prevent crash.")
            return
        }

        FirebaseApp.configure()
        Messaging.messaging().delegate = pushHandler
        logger.info("Firebase initialized successfully")
    }

    private func setupNotificationCenter() {
        UNUserNotificationCenter.current().delegate = localHandler
        localHandler.onDeepLinkRequested = { [weak self] url in
            DispatchQueue.main.async {
                self?.navigationHandler?(url)
            }
        }
    }

    private func setupChannels() {
        NotificationChannelManager.setupChannels()
    }


    // MARK: - Permission Management

    public func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()

        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            logger.info("Notification permission granted: \(granted)")

            if granted {
                await setupForPushNotifications()
            }

            return granted
        } catch {
            logger.error("Failed to request notification permission: \(error.localizedDescription)")
            return false
        }
    }

    public func checkPermissionStatus() async -> UNAuthorizationStatus {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus
    }

    public func getPermissionStatusString() async -> String {
        let authStatus = await checkPermissionStatus()

        switch authStatus {
        case .authorized, .provisional, .ephemeral:
            return "GRANTED"
        case .denied:
            return "DENIED"
        case .notDetermined:
            return "NOT_DETERMINED"
        @unknown default:
            return "NOT_DETERMINED"
        }
    }

    private func setupForPushNotifications() async {
        await MainActor.run {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    // MARK: - Local Notifications

    @discardableResult
    public func scheduleLocal(_ config: NotificationConfig) -> String {
        let notificationId = UUID().uuidString

        Task {
            do {
                let request = await localHandler.createNotificationRequest(config, identifier: notificationId)
                try await UNUserNotificationCenter.current().add(request)

                logger.info("Local notification scheduled with ID: \(notificationId)")
            } catch {
                logger.error("Failed to schedule local notification: \(error.localizedDescription)")
            }
        }

        return notificationId
    }

    public func cancelLocal(_ notificationId: String) -> Bool {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [notificationId])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [notificationId])

        logger.info("Cancelled local notification with ID: \(notificationId)")
        return true
    }

    public func cancelAllLocal() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        logger.info("Cancelled all local notifications")
    }

    // MARK: - Push Notifications

    public func initializePush() async -> (token: String?, error: String?) {
        logger.info("🚀 initializePush called")

        // Check if permissions are granted
        let status = await checkPermissionStatus()
        logger.info("📋 Permission status: \(status.rawValue)")

        if status == .notDetermined {
            // Request permission if not determined yet
            logger.info("📝 Requesting notification permissions")
            let granted = await requestPermission()
            logger.info("✅ Permission granted: \(granted)")
            if !granted {
                logger.error("❌ Permission denied for push notifications")
                return (nil, "Notification permission denied")
            }
        } else if status != .authorized {
            logger.error("❌ Push notifications not authorized. Status: \(status.rawValue)")
            return (nil, "Notification permission not authorized")
        }

        logger.info("🔄 Calling registerForPushNotifications")
        return await pushHandler.registerForPushNotifications()
    }

    public func subscribeToTopic(_ topic: String) async -> Bool {
        return await pushHandler.subscribeToTopic(topic)
    }

    public func unsubscribeFromTopic(_ topic: String) async -> Bool {
        return await pushHandler.unsubscribeFromTopic(topic)
    }

    public func getSubscribedTopics() async -> [String] {
        return await pushHandler.getSubscribedTopics()
    }

    public func handlePushNotification(_ userInfo: [AnyHashable: Any]) {
        if let messageID = userInfo["gcm.message_id"] as? String {
            logger.debug("Firebase Message ID: \(messageID)")
        }
        pushHandler.handleIncomingPush(userInfo)
    }

    public func handlePushToken(_ token: String) {
        pushHandler.handleTokenRefresh(token)
    }

    // MARK: - Badge Management

    public func updateBadge(_ count: Int) {
        Task { @MainActor in
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count) { error in
                    if let error = error {
                        logger.error("Failed to set badge count: \(error)")
                    } else {
                        logger.info("Updated badge count to: \(count)")
                    }
                }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
                logger.info("Updated badge count to: \(count)")
            }
        }
    }

    // MARK: - Navigation

    public func setNavigationHandler(_ handler: @escaping (URL) -> Void) {
        self.navigationHandler = handler
    }

    // MARK: - AppDelegate Integration

    public func handleAppLaunch(with launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
        if let notificationUserInfo = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            logger.info("App launched from push notification")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.handlePushNotification(notificationUserInfo)
            }
        }
    }

    public func handleDeviceTokenRegistration(_ deviceToken: Data) {
        let tokenParts = deviceToken.map { data in String(format: "%02.2hhx", data) }
        let token = tokenParts.joined()
        logger.debug("APNS device token: \(token)")

        // Set APNS token to Firebase
        Messaging.messaging().apnsToken = deviceToken

        // Notify waiting continuation
        pushHandler.notifyAPNSTokenReceived()
    }

    public func handleRegistrationFailure(_ error: Error) {
        logger.error("Failed to register for remote notifications: \(error.localizedDescription)")
    }
}

// MARK: - Channel Management

class NotificationChannelManager {
    static func setupChannels() {
        let center = UNUserNotificationCenter.current()

        // Create categories for action buttons
        var categories = Set<UNNotificationCategory>()

        // Default category (no actions)
        let defaultCategory = UNNotificationCategory(
            identifier: "DEFAULT",
            actions: [],
            intentIdentifiers: [],
            options: []
        )
        categories.insert(defaultCategory)

        // Action buttons category
        let actionCategory = UNNotificationCategory(
            identifier: "ACTION_BUTTONS",
            actions: createDefaultActions(),
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        categories.insert(actionCategory)

        center.setNotificationCategories(categories)

        let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NotificationChannelManager")
        logger.info("Notification channels and categories configured")
    }

    private static func createDefaultActions() -> [UNNotificationAction] {
        return []
    }

    static func createActionsFromConfig(_ actions: [NotificationAction]) -> [UNNotificationAction] {
        return actions.map { actionConfig in
            UNNotificationAction(
                identifier: actionConfig.action,
                title: actionConfig.title,
                options: []
            )
        }
    }

    static func getChannelConfig(_ channelId: String) -> NotificationChannel {
        return NotificationChannel(rawValue: channelId) ?? .default
    }
}