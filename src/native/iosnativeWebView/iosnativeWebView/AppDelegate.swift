import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "AppDelegate")

class AppDelegate: NSObject, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
        logger.info("App delegate didFinishLaunching")
        NotificationManager.shared.handleAppLaunch(with: launchOptions)
        return true
    }

    // MARK: - Push Notification Registration

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        logger.info("Successfully registered for remote notifications")
        NotificationManager.shared.handleDeviceTokenRegistration(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationManager.shared.handleRegistrationFailure(error)
    }

    // MARK: - Push Notification Handling

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable : Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        logger.info("Received remote notification")
        NotificationManager.shared.handlePushNotification(userInfo)
        completionHandler(.newData)
    }

}

// MARK: - Helper Methods

extension AppDelegate {


    // Helper to get current active scene for navigation
    func getCurrentWindow() -> UIWindow? {
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            return scene.windows.first { $0.isKeyWindow }
        }
        return nil
    }
}