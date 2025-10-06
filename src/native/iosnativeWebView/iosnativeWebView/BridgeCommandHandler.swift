//
//  BridgeCommandHandler.swift
//  iosnativeWebView
//
//  Native command implementations for WebView bridge
//  Extracted from NativeBridge.swift for better separation of concerns
//

import Foundation
import UIKit
import AVFoundation
import os

private let commandLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: CatalystConstants.Logging.Categories.commandHandler)

// MARK: - Command Handler Delegate

protocol BridgeCommandHandlerDelegate: AnyObject {
    func sendJSONCallback(eventName: String, data: [String: Any])
    func sendErrorCallback(eventName: String, error: String, code: String)
}

// MARK: - Bridge Command Handler

class BridgeCommandHandler {

    private weak var viewController: UIViewController?
    private let imageHandler: ImageHandler
    private let filePickerHandler: FilePickerHandler
    private weak var delegate: BridgeCommandHandlerDelegate?

    init(viewController: UIViewController, imageHandler: ImageHandler, filePickerHandler: FilePickerHandler) {
        self.viewController = viewController
        self.imageHandler = imageHandler
        self.filePickerHandler = filePickerHandler
        commandLogger.debug("BridgeCommandHandler initialized")
    }

    deinit {
        commandLogger.debug("BridgeCommandHandler deallocated")
    }

    // MARK: - Delegate Management

    func setDelegate(_ delegate: BridgeCommandHandlerDelegate) {
        self.delegate = delegate
    }

    // MARK: - Command Implementations

    // Open camera and capture image
    func openCamera(options: String? = nil) {
        commandLogger.debug("openCamera called with options: \(options ?? "nil")")

        // Parse options if provided
        let cameraOptions = parseCameraOptions(from: options)
        commandLogger.debug("Parsed camera options: \(cameraOptions)")

        // Try to find a valid UIViewController from the window hierarchy
        var presentingViewController: UIViewController?

        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = scene.windows.first?.rootViewController {
            // Use the root view controller or find a presented controller
            presentingViewController = rootVC.presentedViewController ?? rootVC
        } else {
            // Fallback to the provided viewController
            presentingViewController = viewController
        }

        guard let presentingVC = presentingViewController else {
            commandLogger.error("No valid view controller available")
            delegate?.sendErrorCallback(eventName: "ON_CAMERA_ERROR", error: "No valid view controller available", code: "VIEW_CONTROLLER_UNAVAILABLE")
            return
        }

        imageHandler.checkCameraPermission { [weak self] granted in
            guard let self = self else { return }

            if granted {
                self.imageHandler.presentCamera(from: presentingVC, options: cameraOptions)
            } else {
                commandLogger.error("Camera permission denied")
                self.delegate?.sendJSONCallback(eventName: "CAMERA_PERMISSION_STATUS", data: ["status": "DENIED"])
                self.imageHandler.presentPermissionAlert(from: presentingVC)
            }
        }
    }

    func requestCameraPermission(config: String? = nil) {
        commandLogger.debug("Camera permission requested with config: \(config ?? "nil")")

        // Parse config if provided
        let permissionConfig = parsePermissionConfig(from: config)
        commandLogger.debug("Parsed permission config: \(permissionConfig)")

        imageHandler.checkCameraPermission { [weak self] granted in
            guard let self = self else { return }

            let permissionStatus = granted ? "GRANTED" : "DENIED"
            commandLogger.debug("Camera permission status: \(permissionStatus)")

            // Create enhanced response with config consideration
            var response: [String: Any] = [
                "status": permissionStatus,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "platform": "ios"
            ]

            // Add additional info if config requested it
            if let includeDetails = permissionConfig["includeDetails"] as? Bool, includeDetails {
                response["authorizationStatus"] = self.getCameraAuthorizationStatusString()
                response["cameraAvailable"] = UIImagePickerController.isSourceTypeAvailable(.camera)
            }

            self.delegate?.sendJSONCallback(eventName: "CAMERA_PERMISSION_STATUS", data: response)
        }
    }

    // Request haptic feedback
    func requestHapticFeedback(feedbackType: String = "VIRTUAL_KEY") {
        commandLogger.debug("requestHapticFeedback called with type: \(feedbackType)")

        // Check if device supports haptics (iOS 10+)
        guard #available(iOS 10.0, *) else {
            commandLogger.warning("Haptic feedback not supported on this iOS version")
            delegate?.sendErrorCallback(eventName: "HAPTIC_FEEDBACK", error: "Haptic feedback not supported on this iOS version", code: "HAPTIC_NOT_SUPPORTED")
            return
        }

        DispatchQueue.main.async {
            let type = feedbackType.uppercased()
            let feedbackGenerator: UIImpactFeedbackGenerator

            switch type {
            case "VIRTUAL_KEY":
                feedbackGenerator = UIImpactFeedbackGenerator(style: .light)
            case "LONG_PRESS":
                feedbackGenerator = UIImpactFeedbackGenerator(style: .heavy)
            case "DEFAULT":
                feedbackGenerator = UIImpactFeedbackGenerator(style: .light)
            default:
                commandLogger.debug("Unknown haptic type '\(type)', using default (.light)")
                feedbackGenerator = UIImpactFeedbackGenerator(style: .light)
            }

            // Prepare and trigger haptic feedback
            feedbackGenerator.prepare()
            feedbackGenerator.impactOccurred()

            commandLogger.debug("Haptic feedback performed: \(type)")
            self.delegate?.sendJSONCallback(eventName: "HAPTIC_FEEDBACK", data: [
                "status": "success",
                "type": type,
                "platform": "ios"
            ])
        }
    }

    // Get device information
    func getDeviceInfo() {
        commandLogger.debug("getDeviceInfo called")

        let device = UIDevice.current
        let screen = UIScreen.main

        let deviceInfo: [String: Any] = [
            "model": device.model,
            "manufacturer": "Apple",
            "platform": "iOS",
            "systemVersion": device.systemVersion,
            "screenWidth": Int(screen.bounds.width * screen.scale),
            "screenHeight": Int(screen.bounds.height * screen.scale),
            "screenDensity": screen.scale
        ]

        delegate?.sendJSONCallback(eventName: "ON_DEVICE_INFO_SUCCESS", data: deviceInfo)
    }

    // Log message (test function)
    func logger() {
        commandLogger.debug("Message from native")
        delegate?.sendJSONCallback(eventName: "ON_LOGGER", data: ["message": "From native, with regards"])
    }

    // Pick file from device storage
    func pickFile(mimeType: String = "*/*") {
        commandLogger.debug("pickFile called with mimeType: \(mimeType)")

        // Try to find a valid UIViewController from the window hierarchy
        var presentingViewController: UIViewController?

        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = scene.windows.first?.rootViewController {
            // Use the root view controller or find a presented controller
            presentingViewController = rootVC.presentedViewController ?? rootVC
        } else {
            // Fallback to the provided viewController
            presentingViewController = viewController
        }

        guard let presentingVC = presentingViewController else {
            commandLogger.error("No valid view controller available")
            delegate?.sendErrorCallback(eventName: "ON_FILE_PICK_ERROR", error: "No valid view controller available", code: "VIEW_CONTROLLER_UNAVAILABLE")
            return
        }

        filePickerHandler.presentFilePicker(from: presentingVC, mimeType: mimeType)
    }

    // MARK: - Helper Methods

    // Helper method to parse camera options from string parameter
    private func parseCameraOptions(from options: String?) -> [String: Any] {
        var cameraOptions: [String: Any] = [:]

        // Set defaults matching Android implementation
        cameraOptions["quality"] = "medium"
        cameraOptions["format"] = "jpeg"
        cameraOptions["allowEditing"] = false

        guard let optionsString = options, !optionsString.isEmpty else {
            commandLogger.debug("No camera options provided, using defaults")
            return cameraOptions
        }

        do {
            // Try to parse as JSON
            if let data = optionsString.data(using: .utf8),
               let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] {

                // Merge with defaults, allowing JSON to override
                for (key, value) in json {
                    cameraOptions[key] = value
                }
                commandLogger.debug("Successfully parsed camera options from JSON")
            } else {
                // Fallback: treat as simple quality string
                cameraOptions["quality"] = optionsString.lowercased()
                commandLogger.debug("Treated camera options as quality string: \(optionsString)")
            }
        } catch {
            commandLogger.warning("Failed to parse camera options JSON, treating as quality string: \(error.localizedDescription)")
            cameraOptions["quality"] = optionsString.lowercased()
        }

        return cameraOptions
    }

    // Helper method to parse permission config from string parameter
    private func parsePermissionConfig(from config: String?) -> [String: Any] {
        var permissionConfig: [String: Any] = [:]

        // Set defaults
        permissionConfig["includeDetails"] = false

        guard let configString = config, !configString.isEmpty else {
            commandLogger.debug("No permission config provided, using defaults")
            return permissionConfig
        }

        do {
            // Try to parse as JSON
            if let data = configString.data(using: .utf8),
               let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] {

                // Merge with defaults, allowing JSON to override
                for (key, value) in json {
                    permissionConfig[key] = value
                }
                commandLogger.debug("Successfully parsed permission config from JSON")
            } else {
                // Fallback: treat as simple boolean string for includeDetails
                let boolValue = configString.lowercased() == "true" || configString == "1"
                permissionConfig["includeDetails"] = boolValue
                commandLogger.debug("Treated permission config as includeDetails boolean: \(boolValue)")
            }
        } catch {
            commandLogger.warning("Failed to parse permission config JSON, treating as boolean: \(error.localizedDescription)")
            let boolValue = configString.lowercased() == "true" || configString == "1"
            permissionConfig["includeDetails"] = boolValue
        }

        return permissionConfig
    }

    // Helper method to get camera authorization status as string (matching Android format)
    private func getCameraAuthorizationStatusString() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return "GRANTED"  // Match Android GRANTED
        case .notDetermined:
            return "NOT_DETERMINED"  // Match Android NOT_DETERMINED
        case .denied:
            return "DENIED"  // Match Android DENIED
        case .restricted:
            return "RESTRICTED"  // Match Android RESTRICTED
        @unknown default:
            return "DENIED"  // Default to DENIED for unknown states
        }
    }

    // MARK: - Configuration

    // Update view controller reference if needed
    func updateViewController(_ newViewController: UIViewController) {
        self.viewController = newViewController
        commandLogger.debug("View controller reference updated in command handler")
    }

    // MARK: - Notification Methods

    // TODO: replace json data parsing with file intent flow logic
    func requestNotificationPermission() {
        iosnativeWebView.logger.debug("Notification permission requested")

        Task {
            let granted = await notificationManager.requestPermission()
            let status = granted ? "GRANTED" : "DENIED"

            DispatchQueue.main.async {
                let json: [String: Any] = [
                    "status": status,
                    "granted": granted
                ]

                if let jsonData = try? JSONSerialization.data(withJSONObject: json),
                   let jsonString = String(data: jsonData, encoding: .utf8) {
                    self.sendCallback(eventName: "NOTIFICATION_PERMISSION_STATUS", data: jsonString)
                } else {
                    let jsonString = "{\"status\": \"\(status)\", \"granted\": \(granted)}"
                    self.sendCallback(eventName: "NOTIFICATION_PERMISSION_STATUS", data: jsonString)
                }
            }
        }
    }

    func scheduleLocalNotification(_ configString: String?) {
        guard let configString = configString,
              let config = NotificationConfig.fromJSON(configString) else {
            iosnativeWebView.logger.error("Invalid notification configuration")
            let json: [String: Any] = [
                "success": false,
                "error": "Invalid configuration"
            ]

            if let jsonData = try? JSONSerialization.data(withJSONObject: json),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                sendCallback(eventName: "LOCAL_NOTIFICATION_SCHEDULED", data: jsonString)
            } else {
                let jsonString = "{\"success\": false, \"error\": \"Invalid configuration\"}"
                sendCallback(eventName: "LOCAL_NOTIFICATION_SCHEDULED", data: jsonString)
            }
            return
        }

        iosnativeWebView.logger.debug("Scheduling local notification")
        let notificationId = notificationManager.scheduleLocal(config)

        iosnativeWebView.logger.debug("Local notification scheduled with ID: \(notificationId)")

        // Send back the notification ID like Android does
        let json: [String: Any] = [
            "notificationId": notificationId,
            "scheduled": true
        ]

        if let jsonData = try? JSONSerialization.data(withJSONObject: json),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            sendCallback(eventName: "LOCAL_NOTIFICATION_SCHEDULED", data: jsonString)
        } else {
            let jsonString = "{\"notificationId\": \"\(notificationId)\", \"scheduled\": true}"
            sendCallback(eventName: "LOCAL_NOTIFICATION_SCHEDULED", data: jsonString)
        }
    }

    func cancelLocalNotification(_ notificationId: String?) {
        guard let notificationId = notificationId else {
            iosnativeWebView.logger.error("Missing notification ID")
            return
        }

        let success = notificationManager.cancelLocal(notificationId)
        iosnativeWebView.logger.debug("Cancelled notification \(notificationId): \(success)")

        let json: [String: Any] = [
            "notificationId": notificationId,
            "success": success
        ]

        if let jsonData = try? JSONSerialization.data(withJSONObject: json),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            sendCallback(eventName: "LOCAL_NOTIFICATION_CANCELLED", data: jsonString)
        } else {
            let jsonString = "{\"notificationId\": \"\(notificationId)\", \"success\": \(success)}"
            sendCallback(eventName: "LOCAL_NOTIFICATION_CANCELLED", data: jsonString)
        }
    }

    func registerForPushNotifications() {
        iosnativeWebView.logger.debug("Registering for push notifications")

        Task {
            let token = await notificationManager.initializePush()

            DispatchQueue.main.async {
                if let token = token {
                    let json: [String: Any] = [
                        "token": token,
                        "success": true
                    ]

                    if let jsonData = try? JSONSerialization.data(withJSONObject: json),
                       let jsonString = String(data: jsonData, encoding: .utf8) {
                        self.sendCallback(eventName: "PUSH_NOTIFICATION_TOKEN", data: jsonString)
                    } else {
                        let jsonString = "{\"token\": \"\(token)\", \"success\": true}"
                        self.sendCallback(eventName: "PUSH_NOTIFICATION_TOKEN", data: jsonString)
                    }
                } else {
                    let json: [String: Any] = [
                        "success": false,
                        "error": "Failed to get push token"
                    ]

                    if let jsonData = try? JSONSerialization.data(withJSONObject: json),
                       let jsonString = String(data: jsonData, encoding: .utf8) {
                        self.sendCallback(eventName: "PUSH_NOTIFICATION_TOKEN", data: jsonString)
                    } else {
                        let jsonString = "{\"success\": false, \"error\": \"Failed to get push token\"}"
                        self.sendCallback(eventName: "PUSH_NOTIFICATION_TOKEN", data: jsonString)
                    }
                }
            }
        }
    }

    func subscribeToTopic(_ configString: String?) {
        guard let configString = configString,
              let data = configString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let topic = json["topic"] as? String else {
            iosnativeWebView.logger.error("Invalid topic subscription configuration")
            let json: [String: Any] = [
                "success": false,
                "error": "Invalid topic configuration"
            ]

            if let jsonData = try? JSONSerialization.data(withJSONObject: json),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                sendCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: jsonString)
            } else {
                let jsonString = "{\"success\": false, \"error\": \"Invalid topic configuration\"}"
                sendCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: jsonString)
            }
            return
        }

        iosnativeWebView.logger.debug("Subscribing to topic: \(topic)")

        Task {
            let success = await notificationManager.subscribeToTopic(topic)

            DispatchQueue.main.async {
                let json: [String: Any] = [
                    "topic": topic,
                    "success": success,
                    "action": "subscribe"
                ]

                if let jsonData = try? JSONSerialization.data(withJSONObject: json),
                   let jsonString = String(data: jsonData, encoding: .utf8) {
                    self.sendCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: jsonString)
                } else {
                    let jsonString = "{\"topic\": \"\(topic)\", \"success\": \(success), \"action\": \"subscribe\"}"
                    self.sendCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: jsonString)
                }
            }
        }
    }

    func unsubscribeFromTopic(_ configString: String?) {
        guard let configString = configString,
              let data = configString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let topic = json["topic"] as? String else {
            iosnativeWebView.logger.error("Invalid topic unsubscription configuration")
            let json: [String: Any] = [
                "success": false,
                "error": "Invalid topic configuration"
            ]

            if let jsonData = try? JSONSerialization.data(withJSONObject: json),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                sendCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: jsonString)
            } else {
                let jsonString = "{\"success\": false, \"error\": \"Invalid topic configuration\"}"
                sendCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: jsonString)
            }
            return
        }

        iosnativeWebView.logger.debug("Unsubscribing from topic: \(topic)")

        Task {
            let success = await notificationManager.unsubscribeFromTopic(topic)

            DispatchQueue.main.async {
                let json: [String: Any] = [
                    "topic": topic,
                    "success": success,
                    "action": "unsubscribe"
                ]

                if let jsonData = try? JSONSerialization.data(withJSONObject: json),
                   let jsonString = String(data: jsonData, encoding: .utf8) {
                    self.sendCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: jsonString)
                } else {
                    let jsonString = "{\"topic\": \"\(topic)\", \"success\": \(success), \"action\": \"unsubscribe\"}"
                    self.sendCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: jsonString)
                }
            }
        }
    }

    func getSubscribedTopics() {
        iosnativeWebView.logger.debug("Getting subscribed topics")

        Task {
            let topics = await notificationManager.getSubscribedTopics()

            DispatchQueue.main.async {
                let json: [String: Any] = [
                    "topics": topics,
                    "success": true
                ]

                if let jsonData = try? JSONSerialization.data(withJSONObject: json),
                   let jsonString = String(data: jsonData, encoding: .utf8) {
                    self.sendCallback(eventName: "SUBSCRIBED_TOPICS_RESULT", data: jsonString)
                } else {
                    let jsonString = "{\"topics\": [], \"success\": true}"
                    self.sendCallback(eventName: "SUBSCRIBED_TOPICS_RESULT", data: jsonString)
                }
            }
        }
    }

    @objc func updateBadge(_ count: Int) {
        iosnativeWebView.logger.debug("Updating badge count to: \(count)")
        notificationManager.updateBadge(count)
    }
}