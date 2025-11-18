//
//  DeviceInfoUtils.swift
//  iosnativeWebView
//
//  Created by Catalyst Core
//

import Foundation
import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "DeviceInfoUtils")

/// Utility class for retrieving device information
/// Provides device model, manufacturer, platform, screen dimensions, and OS version
class DeviceInfoUtils {

    /// Get comprehensive device information
    /// - Returns: Dictionary containing device information or error details
    static func getDeviceInfo() -> [String: Any] {
        do {
            logger.debug("Fetching device information")

            let device = UIDevice.current
            let screen = UIScreen.main

            // Basic device information
            var deviceInfo: [String: Any] = [
                "model": device.model,
                "manufacturer": "Apple",
                "platform": "ios",
                "systemVersion": device.systemVersion,
                // Screen dimensions in actual pixels
                "screenWidth": Int(screen.bounds.width * screen.scale),
                "screenHeight": Int(screen.bounds.height * screen.scale),
                "screenDensity": screen.scale
            ]

            // Add appInfo from ConfigConstants if available
            if let appInfo = ConfigConstants.appInfo {
                deviceInfo["appInfo"] = appInfo
            } else {
                deviceInfo["appInfo"] = NSNull()
            }

            logger.debug("Device info retrieved successfully: \(deviceInfo.description)")
            return deviceInfo

        } catch {
            logger.error("Error getting device info: \(error.localizedDescription)")
            return [
                "error": "Failed to get device info: \(error.localizedDescription)"
            ]
        }
    }

    /// Get device model name
    /// - Returns: Device model string (e.g., "iPhone", "iPad")
    static func getDeviceModel() -> String {
        return UIDevice.current.model
    }

    /// Get iOS system version
    /// - Returns: System version string (e.g., "17.0")
    static func getSystemVersion() -> String {
        return UIDevice.current.systemVersion
    }

    /// Get screen dimensions
    /// - Returns: Tuple containing width, height, and scale factor
    static func getScreenDimensions() -> (width: Int, height: Int, scale: CGFloat) {
        let screen = UIScreen.main
        let width = Int(screen.bounds.width * screen.scale)
        let height = Int(screen.bounds.height * screen.scale)
        let scale = screen.scale

        return (width: width, height: height, scale: scale)
    }
}
