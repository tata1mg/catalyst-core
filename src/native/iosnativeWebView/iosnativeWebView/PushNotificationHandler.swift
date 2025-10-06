import Foundation
import UIKit
import os

#if canImport(Firebase) && canImport(FirebaseMessaging)
import FirebaseMessaging
import Firebase
#endif

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "PushNotificationHandler")

class PushNotificationHandler: NSObject {
    private var fcmToken: String?
    private var subscribedTopics: Set<String> = []
    private var onTokenRefresh: ((String) -> Void)?

    override init() {
        super.init()
        setupPushNotifications()
    }

    private func setupPushNotifications() {
        logger.info("Setting up push notification handler")
        // Firebase Messaging setup will go here when SDK is integrated
    }

    // MARK: - Push Notification Registration

    func registerForPushNotifications() async -> String? {
        #if canImport(FirebaseMessaging)
        logger.info("Registering for push notifications")

        do {
            let token = try await Messaging.messaging().token()
            self.fcmToken = token
            logger.info("FCM token retrieved: \(token)")
            await requestAPNSToken()
            return token
        } catch {
            logger.error("Failed to retrieve FCM token: \(error.localizedDescription)")
            return nil
        }
        #else
        logger.warning("Push notifications disabled - Firebase packages not available")
        return nil
        #endif
    }

    private func requestAPNSToken() async {
        await MainActor.run {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func handleTokenRefresh(_ newToken: String) {
        logger.info("Push notification token refreshed")
        self.fcmToken = newToken
        onTokenRefresh?(newToken)
    }

    func setTokenRefreshHandler(_ handler: @escaping (String) -> Void) {
        self.onTokenRefresh = handler
    }

    // MARK: - Topic Management

    func subscribeToTopic(_ topic: String) async -> Bool {
        #if canImport(FirebaseMessaging)
        logger.info("Subscribing to topic: \(topic)")

        do {
            try await Messaging.messaging().subscribe(toTopic: topic)
            subscribedTopics.insert(topic)
            logger.info("Successfully subscribed to topic: \(topic)")
            return true
        } catch {
            logger.error("Failed to subscribe to topic \(topic): \(error.localizedDescription)")
            return false
        }
        #else
        logger.warning("Topic subscription disabled - Firebase packages not available")
        return false
        #endif
    }

    func unsubscribeFromTopic(_ topic: String) async -> Bool {
        #if canImport(FirebaseMessaging)
        logger.info("Unsubscribing from topic: \(topic)")

        do {
            try await Messaging.messaging().unsubscribe(fromTopic: topic)
            subscribedTopics.remove(topic)
            logger.info("Successfully unsubscribed from topic: \(topic)")
            return true
        } catch {
            logger.error("Failed to unsubscribe from topic \(topic): \(error.localizedDescription)")
            return false
        }
        #else
        logger.warning("Topic unsubscription disabled - Firebase packages not available")
        return false
        #endif
    }

    func getSubscribedTopics() async -> [String] {
        return Array(subscribedTopics)
    }

    // MARK: - Push Notification Handling

    func handleIncomingPush(_ userInfo: [AnyHashable: Any]) {
        logger.info("Handling incoming push notification")

        // Parse push payload to NotificationConfig
        if let notificationConfig = parsePushPayload(userInfo) {
            // Create local notification from push payload
            let notificationManager = NotificationManager.shared
            notificationManager.scheduleLocal(notificationConfig)

            logger.info("Push notification converted to local notification")
        } else {
            logger.warning("Failed to parse push notification payload")
        }
    }

    // MARK: - Push Payload Parsing

    private func parsePushPayload(_ userInfo: [AnyHashable: Any]) -> NotificationConfig? {
        // Extract payload from Firebase data field
        guard let data = userInfo["data"] as? [String: Any],
              let payloadString = data["payload"] as? String else {
            logger.warning("No payload found in push notification data")
            return nil
        }

        // Parse JSON payload
        return NotificationConfig.fromJSON(payloadString)
    }

}

// MARK: - AppDelegate Integration Helper

extension PushNotificationHandler {
    func handleAPNSToken(_ deviceToken: Data) {
        let tokenParts = deviceToken.map { data in String(format: "%02.2hhx", data) }
        let token = tokenParts.joined()

        logger.info("APNS token received: \(token)")

        #if canImport(FirebaseMessaging)
        // Set APNS token for Firebase
        Messaging.messaging().apnsToken = deviceToken
        #else
        logger.warning("Firebase Messaging disabled - APNS token not set")
        #endif

        handleTokenRefresh(token)
    }

    func handleAPNSError(_ error: Error) {
        logger.error("APNS registration failed: \(error.localizedDescription)")
    }
}

// MARK: - Firebase Messaging Delegate

#if canImport(FirebaseMessaging)
extension PushNotificationHandler: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken = fcmToken else { return }

        logger.info("Firebase registration token: \(fcmToken)")
        self.fcmToken = fcmToken
        onTokenRefresh?(fcmToken)
    }
}
#endif