//
//  iosnativeWebViewApp.swift
//  iosnativeWebView
//
//  Created by Mayank.Mahavar on 05/08/24.
//

import SwiftUI
import UIKit
import os
import CatalystCore
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

// IMPORTANT: This is the App target, so it CAN import CatalystNotifications safely
// This does not create a compile-time dependency in CatalystCore
#if canImport(CatalystNotifications)
import CatalystNotifications
#endif

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "App")

@main
struct iosnativeWebViewApp: App {
    // Connect SwiftUI app to UIKit AppDelegate for early initialization
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    init() {
        logWithTimestamp("🎨 SwiftUI App init() started")

        // Debug: Check module availability and configuration
        #if canImport(CatalystNotifications)
        print("✅ DEBUG [App Init]: CatalystNotifications module CAN be imported")
        #else
        print("❌ DEBUG [App Init]: CatalystNotifications module CANNOT be imported")
        #endif

        print("🔧 DEBUG [App Init]: ConfigConstants.Notifications.enabled = \(ConfigConstants.Notifications.enabled)")
        print("🔧 DEBUG [App Init]: Valid bridge commands: \(CatalystConstants.Bridge.validCommands.sorted().joined(separator: ", "))")

        // Initialize notifications if enabled (runtime injection)
        if ConfigConstants.Notifications.enabled {
            #if canImport(CatalystNotifications)
            logWithTimestamp("📬 Initializing notifications...")
            NotificationManager.shared.initialize(baseURL: ConfigConstants.url)

            // Inject NotificationManager into global provider so Core can call via protocol
            NotificationHandlerProvider.inject(NotificationManager.shared)
            logWithTimestamp("📬 Notifications initialized and handler injected")

            // Forward AppDelegate events to NotificationManager
            NotificationCenter.default.addObserver(forName: NSNotification.Name("APNSDeviceTokenReceived"), object: nil, queue: .main) { note in
                if let deviceToken = note.userInfo?["deviceToken"] as? Data {
                    NotificationManager.shared.handleDeviceTokenRegistration(deviceToken)
                }
            }
            NotificationCenter.default.addObserver(forName: NSNotification.Name("APNSRegistrationFailed"), object: nil, queue: .main) { note in
                if let error = note.userInfo?["error"] as? Error {
                    NotificationManager.shared.handleRegistrationFailure(error)
                }
            }
            NotificationCenter.default.addObserver(forName: NSNotification.Name("RemoteNotificationReceived"), object: nil, queue: .main) { note in
                if let userInfo = note.userInfo?["notification"] as? [AnyHashable: Any],
                   let completion = note.userInfo?["completion"] as? (UIBackgroundFetchResult) -> Void {
                    NotificationManager.shared.handlePushNotification(userInfo)
                    completion(.newData)
                }
            }
            #else
            logWithTimestamp("⚠️ Notifications enabled in config but CatalystNotifications module not available")
            #endif
        } else {
            logWithTimestamp("📬 Notifications disabled in config")
            // Ensure stub is active when disabled
            NotificationHandlerProvider.inject(NullNotificationHandler.shared)
        }

        logWithTimestamp("🎨 SwiftUI App init() completed (AppDelegate handles boot tasks)")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onAppear {
                    logWithTimestamp("🎨 WindowGroup ContentView appeared")
                }
                .onOpenURL { url in
                    #if canImport(GoogleSignIn)
                    if GIDSignIn.sharedInstance.handle(url) {
                        logWithTimestamp("🔐 Google Sign-In handled via onOpenURL")
                    }
                    #endif
                }
        }
    }
}
