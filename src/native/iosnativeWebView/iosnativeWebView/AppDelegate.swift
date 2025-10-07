//
//  AppDelegate.swift
//  iosnativeWebView
//
//  UIKit AppDelegate for immediate boot-time initialization
//

import UIKit
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "AppDelegate")

class AppDelegate: NSObject, UIApplicationDelegate {

    // Shared process pool for WebKit process reuse
    static let sharedProcessPool = WKProcessPool()

    // Pre-warmed WebView to trigger process launch early
    static var preWarmedWebView: WKWebView?

    func application(
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
        _ = Self.sharedProcessPool
        logWithTimestamp("🔥 WebKit ProcessPool pre-allocated for reuse")

        logWithTimestamp("✅ AppDelegate initialization complete")

        // 3. Notifications
        // Handle app launch from notification
        NotificationManager.shared.handleAppLaunch(with: launchOptions)

        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        logger.info("📱 APNS device token received in AppDelegate")
        NotificationManager.shared.handleDeviceTokenRegistration(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        logger.error("❌ Failed to register for remote notifications in AppDelegate")
        NotificationManager.shared.handleRegistrationFailure(error)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationManager.shared.handlePushNotification(userInfo)
        completionHandler(.newData)
    }
}
