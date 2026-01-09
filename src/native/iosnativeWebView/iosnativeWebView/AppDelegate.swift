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

        // 2. Pre-allocate WebKit process pool (used only for < iOS 15).
        if let preWarmedWebView = WebKitConfig.prewarmProcessPoolIfNeeded() {
            AppDelegate.preWarmedWebView = preWarmedWebView
            logWithTimestamp("🔥 WebKit ProcessPool prewarmed for legacy iOS versions")
        } else {
            logWithTimestamp("🔥 WebKit ProcessPool prewarm skipped (ignored on iOS 15+)")
        }

        logWithTimestamp("✅ AppDelegate initialization complete")

        // Notifications are initialized from iosnativeWebViewApp and events are forwarded via NotificationCenter
        return true
    }

    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        logger.info("📱 APNS device token received in AppDelegate")
        NotificationCenter.default.post(
            name: NSNotification.Name("APNSDeviceTokenReceived"),
            object: nil,
            userInfo: ["deviceToken": deviceToken]
        )
    }

    public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        logger.error("❌ Failed to register for remote notifications in AppDelegate")
        NotificationCenter.default.post(
            name: NSNotification.Name("APNSRegistrationFailed"),
            object: nil,
            userInfo: ["error": error]
        )
    }

    public func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(
            name: NSNotification.Name("RemoteNotificationReceived"),
            object: nil,
            userInfo: ["notification": userInfo, "completion": completionHandler]
        )
    }
}
