import UIKit

class AppDelegate: NSObject, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
        #if canImport(Firebase)
        // Handle app launch from notification
        // NotificationManager.shared.handleAppLaunch(with: launchOptions)
        #else
        // Notifications disabled - skip initialization
        print("⚠️ Notifications disabled (Firebase packages not available)")
        #endif

        return true
    }

    // MARK: - Push Notification Handling

    #if canImport(Firebase)
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationManager.shared.handleDeviceTokenRegistration(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationManager.shared.handleRegistrationFailure(error)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationManager.shared.handlePushNotification(userInfo)
        completionHandler(.newData)
    }
    #endif

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