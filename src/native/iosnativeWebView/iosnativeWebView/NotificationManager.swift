import Foundation
import UserNotifications
import UIKit
import os

#if canImport(Firebase) && canImport(FirebaseMessaging)
import Firebase
import FirebaseMessaging
#endif

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NotificationManager")

class NotificationManager: ObservableObject {
    static let shared = NotificationManager()

    private let localHandler: LocalNotificationHandler
    private let pushHandler: PushNotificationHandler
    private var navigationHandler: ((URL) -> Void)?


    private init() {
        self.localHandler = LocalNotificationHandler(baseURL: ConfigConstants.url)
        self.pushHandler = PushNotificationHandler()

        // initializeFirebase()
        setupNotificationCenter()
        setupChannels()
    }

    private func initializeFirebase() {
        #if canImport(Firebase) && canImport(FirebaseMessaging)
        FirebaseApp.configure()
        Messaging.messaging().delegate = pushHandler
        logger.info("Firebase initialized successfully")
        #else
        logger.warning("Firebase disabled - push notifications not available (Firebase packages not found)")
        #endif
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

    func requestPermission() async -> Bool {
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

    func checkPermissionStatus() async -> UNAuthorizationStatus {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus
    }

    private func setupForPushNotifications() async {
        await MainActor.run {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    // MARK: - Local Notifications

    @discardableResult
    func scheduleLocal(_ config: NotificationConfig) -> String {
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

    func cancelLocal(_ notificationId: String) -> Bool {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [notificationId])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [notificationId])

        logger.info("Cancelled local notification with ID: \(notificationId)")
        return true
    }

    func cancelAllLocal() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        logger.info("Cancelled all local notifications")
    }

    // MARK: - Push Notifications

    func initializePush() async -> String? {
        return await pushHandler.registerForPushNotifications()
    }

    func subscribeToTopic(_ topic: String) async -> Bool {
        return await pushHandler.subscribeToTopic(topic)
    }

    func unsubscribeFromTopic(_ topic: String) async -> Bool {
        return await pushHandler.unsubscribeFromTopic(topic)
    }

    func getSubscribedTopics() async -> [String] {
        return await pushHandler.getSubscribedTopics()
    }

    func handlePushNotification(_ userInfo: [AnyHashable: Any]) {
        if let messageID = userInfo["gcm.message_id"] as? String {
            logger.debug("Firebase Message ID: \(messageID)")
        }
        pushHandler.handleIncomingPush(userInfo)
    }

    func handlePushToken(_ token: String) {
        pushHandler.handleTokenRefresh(token)
    }

    // MARK: - Badge Management

    func updateBadge(_ count: Int) {
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

    func setNavigationHandler(_ handler: @escaping (URL) -> Void) {
        self.navigationHandler = handler
    }

    // MARK: - AppDelegate Integration

    func handleAppLaunch(with launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
        if let notificationUserInfo = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            logger.info("App launched from push notification")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.handlePushNotification(notificationUserInfo)
            }
        }
    }

    func handleDeviceTokenRegistration(_ deviceToken: Data) {
        let tokenParts = deviceToken.map { data in String(format: "%02.2hhx", data) }
        let token = tokenParts.joined()
        logger.debug("APNS device token: \(token)")

        handlePushToken(token)
        #if canImport(FirebaseMessaging)
        Messaging.messaging().apnsToken = deviceToken
        #else
        logger.warning("Firebase Messaging disabled - APNS token not registered")
        #endif
    }

    func handleRegistrationFailure(_ error: Error) {
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