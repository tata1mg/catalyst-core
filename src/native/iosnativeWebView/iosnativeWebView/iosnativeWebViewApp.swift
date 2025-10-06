//
//  iosnativeWebViewApp.swift
//  iosnativeWebView
//
//  Created by Mayank.Mahavar on 05/08/24.
//

import SwiftUI
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "App")

@main
struct iosnativeWebViewApp: App {
    // Connect SwiftUI app to UIKit AppDelegate for early initialization
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    init() {
        logWithTimestamp("🎨 SwiftUI App init() started")
        logWithTimestamp("🎨 SwiftUI App init() completed (AppDelegate handles boot tasks)")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onAppear {
                    logWithTimestamp("🎨 WindowGroup ContentView appeared")
                }
        }
    }
}
