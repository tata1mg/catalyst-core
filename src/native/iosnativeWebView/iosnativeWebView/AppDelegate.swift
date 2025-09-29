import UIKit
import UserNotifications
import os
import Firebase
import FirebaseMessaging

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "AppDelegate")

class AppDelegate: NSObject, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {

        logger.info("App delegate didFinishLaunching")

        // Initialize Firebase
        FirebaseApp.configure()

        // Set FCM messaging delegate
        Messaging.messaging().delegate = NotificationManager.shared.pushHandler

        // Check if app was launched from notification
        if let notificationUserInfo = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            logger.info("App launched from push notification")
            handleLaunchNotification(notificationUserInfo)
        }

        return true
    }

    // MARK: - Push Notification Registration

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        logger.info("Successfully registered for remote notifications")

        let tokenParts = deviceToken.map { data in String(format: "%02.2hhx", data) }
        let token = tokenParts.joined()

        logger.debug("APNS device token: \(token)")

        // Pass token to notification manager
        NotificationManager.shared.handlePushToken(token)

        // Set APNS token for Firebase
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        logger.error("Failed to register for remote notifications: \(error.localizedDescription)")

        // Notify JavaScript about registration failure
        let notificationManager = NotificationManager.shared
        notificationManager.setNotificationCallback { eventName, data in
            // This will be called when the callback is set up
        }
    }

    // MARK: - Push Notification Handling

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable : Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {

        logger.info("Received remote notification")

        // Handle the push notification through our notification manager
        NotificationManager.shared.handlePushNotification(userInfo)

        // Log Firebase message ID if present
        if let messageID = userInfo["gcm.message_id"] {
            logger.debug("Firebase Message ID: \(messageID)")
        }

        completionHandler(.newData)
    }

    // Handle notification when app is in foreground or background
    private func handleLaunchNotification(_ userInfo: [AnyHashable: Any]) {
        // Extract and handle the notification data
        logger.info("Handling launch notification with data: \(userInfo)")

        // Delay handling to ensure app is fully loaded
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            NotificationManager.shared.handlePushNotification(userInfo)
        }
    }
}

// MARK: - Helper Methods

extension AppDelegate {

    // Initialize notification system - this does NOT set the delegate
    func configureNotificationSystem() {
        // The delegate is already set in NotificationManager
        // This method can be used for any additional app-level configuration
        logger.info("Notification system configured")
    }

    // Helper to get current active scene for navigation
    func getCurrentWindow() -> UIWindow? {
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            return scene.windows.first { $0.isKeyWindow }
        }
        return nil
    }
}