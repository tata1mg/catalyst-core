//
//  AppDelegate.swift
//  iosnativeWebView
//
//  UIKit AppDelegate for immediate boot-time initialization
//

import UIKit
import WebKit
import os
import CatalystCore

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "AppDelegate")

public class AppDelegate: NSObject, UIApplicationDelegate {

    // Pre-warmed WebView to trigger process launch early
    public static var preWarmedWebView: WKWebView?

    // Hold reference to NotificationFeature (will be nil if disabled)
    private var notificationFeature: AnyObject?

    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        logWithTimestamp("🚀 AppDelegate didFinishLaunchingWithOptions")

        // 1. Initialize CacheManager immediately
        let cacheStart = CFAbsoluteTimeGetCurrent()
        _ = CacheManager.shared
        let cacheTime = (CFAbsoluteTimeGetCurrent() - cacheStart) * 1000
        logWithTimestamp("📦 CacheManager initialized in didFinishLaunching (took \(String(format: "%.2f", cacheTime))ms)")

        // 2. Pre-allocate WebKit process pool (lightweight, no processes launched yet)
        // Real WebView will use this pool and launch processes on first load
        _ = WebKitConfig.sharedProcessPool
        logWithTimestamp("🔥 WebKit ProcessPool pre-allocated for reuse")

        logWithTimestamp("✅ AppDelegate initialization complete")

        // 3. Notifications (runtime check, no compile-time dependency)
        if ConfigConstants.Notifications.enabled {
            logWithTimestamp("📬 Notifications enabled in config - will inject handler when WebView initializes")
            // NOTE: Actual notification initialization will happen in iosnativeWebViewApp.swift
            // which can safely import CatalystNotifications (it's in the App target, not CatalystCore)
        } else {
            logWithTimestamp("📬 Notifications disabled in config")
        }

        return true
    }

    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        logger.info("📱 APNS device token received in AppDelegate")
        // Notification feature will be injected via NotificationFeature if enabled
        if ConfigConstants.Notifications.enabled {
            // This will be handled in iosnativeWebViewApp where we can safely import CatalystNotifications
            NotificationCenter.default.post(
                name: NSNotification.Name("APNSDeviceTokenReceived"),
                object: nil,
                userInfo: ["deviceToken": deviceToken]
            )
        }
    }

    public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        logger.error("❌ Failed to register for remote notifications in AppDelegate")
        if ConfigConstants.Notifications.enabled {
            NotificationCenter.default.post(
                name: NSNotification.Name("APNSRegistrationFailed"),
                object: nil,
                userInfo: ["error": error]
            )
        }
    }

    public func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        if ConfigConstants.Notifications.enabled {
            NotificationCenter.default.post(
                name: NSNotification.Name("RemoteNotificationReceived"),
                object: nil,
                userInfo: ["notification": userInfo, "completion": completionHandler]
            )
        } else {
            completionHandler(.noData)
        }
    }
}
