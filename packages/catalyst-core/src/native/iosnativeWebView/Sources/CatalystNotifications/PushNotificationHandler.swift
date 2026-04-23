import Foundation
import UIKit
import os
import CatalystCore
import FirebaseMessaging
import FirebaseCore

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "PushNotificationHandler")

class PushNotificationHandler: NSObject {
    private var fcmToken: String?
    private var subscribedTopics: Set<String> = []
    private var onTokenRefresh: ((String) -> Void)?
    private var apnsTokenContinuation: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        setupPushNotifications()
    }

    private func setupPushNotifications() {
        logger.info("Setting up push notification handler")
        // Firebase Messaging setup will go here when SDK is integrated
    }

    // MARK: - Push Notification Registration

    func registerForPushNotifications() async -> (token: String?, error: String?) {
        logger.info("Registering for push notifications")

        #if targetEnvironment(simulator)
        logger.warning("⚠️ Running on simulator - APNS not supported. Push notifications require a physical device.")
        return (nil, "Simulator not supported. Push notifications require a physical device.")
        #else

        // Wait for APNS token to be set
        await withCheckedContinuation { continuation in
            self.apnsTokenContinuation = continuation

            // Register for APNS - this will eventually call handleAPNSToken
            Task { @MainActor in
                logger.info("📞 Calling registerForRemoteNotifications")
                UIApplication.shared.registerForRemoteNotifications()
            }
        }

        logger.info("✅ APNS token received, now getting FCM token")

        // Now get FCM token with timeout - APNS token is guaranteed to be set
        return await withTaskGroup(of: (String?, String?).self) { group in
            // Task 1: Get FCM token
            group.addTask {
                await withCheckedContinuation { continuation in
                    Messaging.messaging().token { token, error in
                        if let error = error {
                            let errorMsg = "FCM token error: \(error.localizedDescription)"
                            logger.error("\(errorMsg)")
                            continuation.resume(returning: (nil, errorMsg))
                        } else if let token = token {
                            self.fcmToken = token
                            logger.info("FCM token retrieved: \(token)")
                            continuation.resume(returning: (token, nil))
                        } else {
                            continuation.resume(returning: (nil, "FCM token retrieval returned nil"))
                        }
                    }
                }
            }
            
            // Task 2: Timeout after 30 seconds
            group.addTask {
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30 seconds
                return (nil, "FCM token request timed out after 30 seconds. Check network connectivity and Firebase configuration.")
            }
            
            // Return the first result (either token or timeout)
            if let result = await group.next() {
                group.cancelAll()
                return result
            }
            
            return (nil, "Unknown error getting FCM token")
        }
        #endif
    }

    func notifyAPNSTokenReceived() {
        apnsTokenContinuation?.resume()
        apnsTokenContinuation = nil
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
    }

    func unsubscribeFromTopic(_ topic: String) async -> Bool {
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

        // Set APNS token for Firebase
        Messaging.messaging().apnsToken = deviceToken

        handleTokenRefresh(token)
    }

    func handleAPNSError(_ error: Error) {
        logger.error("APNS registration failed: \(error.localizedDescription)")
    }
}

// MARK: - Firebase Messaging Delegate

extension PushNotificationHandler: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken = fcmToken else { return }

        logger.info("Firebase registration token: \(fcmToken)")
        self.fcmToken = fcmToken
        onTokenRefresh?(fcmToken)
    }
}