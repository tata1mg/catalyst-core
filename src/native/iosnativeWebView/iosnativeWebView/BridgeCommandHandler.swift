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

        let deviceInfo = DeviceInfoUtils.getDeviceInfo()

        // Check if there was an error
        if let error = deviceInfo["error"] as? String {
            commandLogger.error("Failed to get device info: \(error)")
            delegate?.sendErrorCallback(
                eventName: "ON_DEVICE_INFO_ERROR",
                error: error,
                code: "DEVICE_INFO_ERROR"
            )
            return
        }

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
}