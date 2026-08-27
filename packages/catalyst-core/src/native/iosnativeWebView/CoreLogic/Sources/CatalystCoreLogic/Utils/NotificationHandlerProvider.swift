//
//  NotificationHandlerProvider.swift
//  CatalystCore
//
//  Global provider for notification handler - allows runtime injection
//

import Foundation

/// Global provider for notification handler
/// Allows the App target to inject the real NotificationManager when notifications are enabled
public class NotificationHandlerProvider {
    public static var shared: NotificationHandlerProtocol = NullNotificationHandler.shared
    
    /// Inject the notification handler at app startup
    /// Call this from the App target when notifications are enabled
    public static func inject(_ handler: NotificationHandlerProtocol) {
        shared = handler
    }
}
