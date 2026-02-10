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
import UserNotifications
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

private let commandLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: CatalystConstants.Logging.Categories.commandHandler)

// MARK: - Command Handler Delegate

protocol BridgeCommandHandlerDelegate: AnyObject {
    func sendStringCallback(eventName: String, data: String)
    func sendJSONCallback(eventName: String, data: [String: Any])
    func sendErrorCallback(eventName: String, error: String, code: String)
}

// MARK: - Bridge Command Handler

class BridgeCommandHandler {

    private weak var viewController: UIViewController?
    private let imageHandler: ImageHandler
    private let filePickerHandler: FilePickerHandler
    private weak var delegate: BridgeCommandHandlerDelegate?

    // Notification handler - injected, defaults to null implementation
    private var notificationHandler: NotificationHandlerProtocol = NullNotificationHandler.shared
    private var isGoogleSignInInProgress = false
    private var hasAttemptedGoogleRestore = false

    private struct GoogleSignInOptions {
        let clientId: String?
        let nonce: String?
        let hint: String?
        let additionalScopes: [String]?
        let autoSelect: Bool
        let filterByAuthorizedAccounts: Bool

        static func from(params: Any?) -> GoogleSignInOptions {
            if let stringParam = params as? String, !stringParam.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if let data = stringParam.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    return GoogleSignInOptions.fromDictionary(json)
                }

                let trimmed = stringParam.trimmingCharacters(in: .whitespacesAndNewlines)
                return GoogleSignInOptions(
                    clientId: trimmed,
                    nonce: nil,
                    hint: nil,
                    additionalScopes: nil,
                    autoSelect: false,
                    filterByAuthorizedAccounts: false
                )
            }

            if let dict = params as? [String: Any] {
                return GoogleSignInOptions.fromDictionary(dict)
            }

            return GoogleSignInOptions(
                clientId: nil,
                nonce: nil,
                hint: nil,
                additionalScopes: nil,
                autoSelect: false,
                filterByAuthorizedAccounts: false
            )
        }

        private static func fromDictionary(_ dict: [String: Any]) -> GoogleSignInOptions {
            func clean(_ value: String?) -> String? {
                guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
                return value
            }

            let resolvedClientId = clean(dict["clientId"] as? String) ??
                clean(dict["webClientId"] as? String)

            let nonce = clean(dict["nonce"] as? String)
            let hint = clean(dict["hint"] as? String ?? dict["email"] as? String)
            var scopes: [String]?

            if let scopesArray = dict["additionalScopes"] as? [String] {
                let filtered = scopesArray.compactMap { clean($0) }
                scopes = filtered.isEmpty ? nil : filtered
            } else if let scopesString = clean(dict["additionalScopes"] as? String) {
                let splitScopes = scopesString.split(separator: ",").map { clean(String($0)) }.compactMap { $0 }
                scopes = splitScopes.isEmpty ? nil : splitScopes
            }

            return GoogleSignInOptions(
                clientId: resolvedClientId,
                nonce: nonce,
                hint: hint,
                additionalScopes: scopes,
                autoSelect: dict["autoSelect"] as? Bool ?? false,
                filterByAuthorizedAccounts: dict["filterByAuthorizedAccounts"] as? Bool ?? false
            )
        }
    }

    init(viewController: UIViewController, imageHandler: ImageHandler, filePickerHandler: FilePickerHandler) {
        self.viewController = viewController
        self.imageHandler = imageHandler
        self.filePickerHandler = filePickerHandler

        commandLogger.debug("BridgeCommandHandler initialized")
        commandLogger.debug("Notifications enabled: \(ConfigConstants.Notifications.enabled)")
    }

    // Inject notification handler (called from AppDelegate when notifications enabled)
    func setNotificationHandler(_ handler: NotificationHandlerProtocol) {
        self.notificationHandler = handler
        commandLogger.debug("Notification handler injected: \(type(of: handler))")
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

    func googleSignIn(params: Any?) {
        #if canImport(GoogleSignIn)
        guard ConfigConstants.GoogleSignIn.enabled else {
            delegate?.sendErrorCallback(
                eventName: "ON_GOOGLE_SIGN_IN_ERROR",
                error: "Google Sign-In is disabled in config",
                code: "GOOGLE_SIGN_IN_ERROR"
            )
            return
        }

        let options = GoogleSignInOptions.from(params: params)

        let resolvedClientId = (options.clientId ?? ConfigConstants.GoogleSignIn.clientId)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !resolvedClientId.isEmpty else {
            delegate?.sendErrorCallback(
                eventName: "ON_GOOGLE_SIGN_IN_ERROR",
                error: "clientId is required for Google Sign-In",
                code: "GOOGLE_SIGN_IN_ERROR"
            )
            return
        }

        guard !isGoogleSignInInProgress else {
            delegate?.sendErrorCallback(
                eventName: "ON_GOOGLE_SIGN_IN_ERROR",
                error: "A Google Sign-In request is already in progress",
                code: "GOOGLE_SIGN_IN_ERROR"
            )
            return
        }

        guard let presentingVC = resolvePresentingViewController() else {
            delegate?.sendErrorCallback(
                eventName: "ON_GOOGLE_SIGN_IN_ERROR",
                error: "No valid view controller available for Google Sign-In",
                code: "GOOGLE_SIGN_IN_ERROR"
            )
            return
        }

        isGoogleSignInInProgress = true
        commandLogger.debug("Starting Google Sign-In with clientId prefix: \(resolvedClientId.prefix(12))...")

        configureGoogleSignIn(clientId: resolvedClientId)

        if options.autoSelect || options.filterByAuthorizedAccounts {
            commandLogger.debug("Google Sign-In options autoSelect/filterByAuthorizedAccounts are not supported on iOS SDK and will be ignored")
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            GIDSignIn.sharedInstance.signIn(
                withPresenting: presentingVC,
                hint: options.hint,
                additionalScopes: options.additionalScopes
            ) { [weak self] result, error in
                guard let self = self else { return }
                self.isGoogleSignInInProgress = false

                let hasValidUserData = result?.user != nil && result?.user.idToken?.tokenString != nil

                if let error = error as NSError? {
                    if self.isCancelledGoogleError(error) {
                        self.delegate?.sendErrorCallback(
                            eventName: "ON_GOOGLE_SIGN_IN_CANCELLED",
                            error: "User cancelled Google sign-in",
                            code: "OPERATION_CANCELLED"
                        )
                        return
                    }

                    let errorDescription = error.localizedDescription.lowercased()
                    let isKeychainError = errorDescription.contains("keychain")

                    if isKeychainError && hasValidUserData {
                        commandLogger.warning("Google Sign-In keychain error (common on simulators), but user data is valid: \(error.localizedDescription)")
                    } else {
                        commandLogger.error("Google Sign-In error: \(error.localizedDescription)")
                        self.delegate?.sendErrorCallback(
                            eventName: "ON_GOOGLE_SIGN_IN_ERROR",
                            error: error.localizedDescription,
                            code: "GOOGLE_SIGN_IN_ERROR"
                        )
                        return
                    }
                }

                guard let user = result?.user, let idToken = user.idToken?.tokenString else {
                    self.delegate?.sendErrorCallback(
                        eventName: "ON_GOOGLE_SIGN_IN_ERROR",
                        error: "No ID token returned from Google sign-in",
                        code: "GOOGLE_SIGN_IN_ERROR"
                    )
                    return
                }

                var payload: [String: Any] = [
                    "idToken": idToken,
                    "provider": "google"
                ]

                if let email = user.profile?.email, !email.isEmpty {
                    payload["email"] = email
                }

                if let name = user.profile?.name, !name.isEmpty {
                    payload["name"] = name
                }

                if let photoUrl = user.profile?.imageURL(withDimension: 160)?.absoluteString, !photoUrl.isEmpty {
                    payload["photoUrl"] = photoUrl
                }

                if let serverAuthCode = result?.serverAuthCode, !serverAuthCode.isEmpty {
                    payload["serverAuthCode"] = serverAuthCode
                }

                commandLogger.debug("Google Sign-In success (idToken length: \(idToken.count))")
                self.delegate?.sendJSONCallback(eventName: "ON_GOOGLE_SIGN_IN_SUCCESS", data: payload)
            }
        }
        #else
        delegate?.sendErrorCallback(
            eventName: "ON_GOOGLE_SIGN_IN_ERROR",
            error: "Google Sign-In SDK not available on this build",
            code: "GOOGLE_SIGN_IN_UNAVAILABLE"
        )
        #endif
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
    func pickFile(options optionsString: String? = nil) {
        commandLogger.debug("pickFile called with options: \(optionsString ?? "nil")")
        let options = FilePickerOptions.from(raw: optionsString)
        commandLogger.debug("Parsed file picker options: \(options)")

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

        filePickerHandler.presentFilePicker(from: presentingVC, options: options)
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
        // Check if notifications are enabled in config
        guard ConfigConstants.Notifications.enabled else {
            commandLogger.warning("Notification permission requested but notifications are disabled in config")
            delegate?.sendStringCallback(eventName: "NOTIFICATION_PERMISSION_STATUS", data: "DENIED")
            return
        }

        commandLogger.debug("Notification permission requested")

        Task { [weak self] in
            guard let self else { return }
            let granted = await self.notificationHandler.requestPermission()
            let status = granted ? "GRANTED" : "DENIED"

            await MainActor.run {
                guard let delegate = self.delegate else {
                    commandLogger.debug("Delegate released before NOTIFICATION_PERMISSION_STATUS callback")
                    return
                }
                // Send plain string to match Android's BridgeUtils.notifyWeb format
                delegate.sendStringCallback(eventName: "NOTIFICATION_PERMISSION_STATUS", data: status)
                commandLogger.debug("Notification permission granted: \(granted)")
            }
        }
    }

    func checkNotificationPermissionStatus() {
        // Check if notifications are enabled in config
        guard ConfigConstants.Notifications.enabled else {
            commandLogger.warning("Check notification permission status called but notifications are disabled in config")
            delegate?.sendStringCallback(eventName: "NOTIFICATION_PERMISSION_STATUS", data: "DENIED")
            return
        }

        commandLogger.debug("Checking notification permission status")

        Task { [weak self] in
            guard let self else { return }
            let status = await self.notificationHandler.getPermissionStatusString()

            await MainActor.run {
                guard let delegate = self.delegate else {
                    commandLogger.debug("Delegate released before NOTIFICATION_PERMISSION_STATUS callback")
                    return
                }
                delegate.sendStringCallback(eventName: "NOTIFICATION_PERMISSION_STATUS", data: status)
                commandLogger.debug("Notification permission status: \(status)")
            }
        }
    }

    func scheduleLocalNotification(_ configString: String?) {
        // Check if notifications are enabled in config
        guard ConfigConstants.Notifications.enabled else {
            commandLogger.warning("Local notification requested but notifications are disabled in config")
            delegate?.sendJSONCallback(eventName: "LOCAL_NOTIFICATION_SCHEDULED", data: [
                "success": false,
                "error": "Notifications disabled in configuration"
            ])
            return
        }

        // Log the raw input for debugging
        if let configString = configString {
            commandLogger.debug("Received notification config string: \(configString)")
        } else {
            commandLogger.error("Received nil config string")
        }

        guard let configString = configString,
              let data = configString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let title = json["title"] as? String,
              let body = json["body"] as? String else {
            commandLogger.error("Invalid notification configuration - failed to parse JSON")
            if let configString = configString {
                commandLogger.error("Failed config string was: \(configString)")
            }
            delegate?.sendJSONCallback(eventName: "LOCAL_NOTIFICATION_SCHEDULED", data: [
                "success": false,
                "error": "Invalid configuration"
            ])
            return
        }

        // Parse notification config and map to NotificationConfig model
        let channel = (json["channel"] as? String)
            ?? ((json["sound"] as? String) == "urgent" ? "urgent" : "default")
        let style = (json["style"] as? String) ?? "BASIC"
        let largeImage = json["largeImage"] as? String
        let priority = json["priority"] as? Int ?? 0
        let vibrate = json["vibrate"] as? Bool ?? true
        let autoCancel = json["autoCancel"] as? Bool ?? true
        let dataDict = json["data"] as? [String: Any]

        var actionsConfig: [NotificationAction]? = nil
        if let actionsArray = json["actions"] as? [[String: Any]] {
            actionsConfig = actionsArray.compactMap { item in
                let title = item["title"] as? String ?? ""
                let action = item["action"] as? String ?? ""
                return (title.isEmpty || action.isEmpty) ? nil : NotificationAction(title: title, action: action)
            }
        }

        let config = NotificationConfig(
            title: title,
            body: body,
            channel: channel,
            badge: json["badge"] as? Int,
            largeImage: largeImage,
            style: style,
            priority: priority,
            vibrate: vibrate,
            autoCancel: autoCancel,
            data: dataDict,
            actions: actionsConfig
        )

        commandLogger.debug("Scheduling local notification")
        let notificationId = notificationHandler.scheduleLocal(config)

        commandLogger.debug("Local notification scheduled with ID: \(notificationId)")

        // Send back the notification ID like Android does
        delegate?.sendJSONCallback(eventName: "LOCAL_NOTIFICATION_SCHEDULED", data: [
            "notificationId": notificationId,
            "scheduled": true
        ])
    }

    func cancelLocalNotification(_ notificationId: String?) {
        // Check if notifications are enabled in config
        guard ConfigConstants.Notifications.enabled else {
            commandLogger.warning("Cancel notification requested but notifications are disabled in config")
            delegate?.sendJSONCallback(eventName: "LOCAL_NOTIFICATION_CANCELLED", data: [
                "notificationId": notificationId ?? "",
                "success": false,
                "error": "Notifications disabled in configuration"
            ])
            return
        }

        guard let notificationId = notificationId else {
            commandLogger.error("Missing notification ID")
            return
        }

        let success = notificationHandler.cancelLocal(notificationId)
        commandLogger.debug("Cancelled notification \(notificationId): \(success)")

        delegate?.sendJSONCallback(eventName: "LOCAL_NOTIFICATION_CANCELLED", data: [
            "notificationId": notificationId,
            "success": success
        ])
    }

    func registerForPushNotifications() {
        // Check if notifications are enabled in config
        guard ConfigConstants.Notifications.enabled else {
            commandLogger.warning("Push notification registration requested but notifications are disabled in config")
            delegate?.sendJSONCallback(eventName: "PUSH_NOTIFICATION_TOKEN", data: [
                "success": false,
                "error": "Notifications disabled in configuration"
            ])
            return
        }

        commandLogger.debug("Registering for push notifications")

        Task { [weak self] in
            guard let self else { return }
            let (token, error) = await self.notificationHandler.initializePush()

            await MainActor.run {
                guard let delegate = self.delegate else {
                    commandLogger.debug("Delegate released before PUSH_NOTIFICATION_TOKEN callback")
                    return
                }
                if let token = token {
                    delegate.sendJSONCallback(eventName: "PUSH_NOTIFICATION_TOKEN", data: [
                        "token": token,
                        "success": true
                    ])
                } else {
                    let errorMessage = error ?? "Failed to get push token"
                    commandLogger.error("Push notification registration failed: \(errorMessage)")
                    delegate.sendJSONCallback(eventName: "PUSH_NOTIFICATION_TOKEN", data: [
                        "success": false,
                        "error": errorMessage
                    ])
                }
            }
        }
    }

    func subscribeToTopic(_ configString: String?) {
        // Check if notifications are enabled in config
        guard ConfigConstants.Notifications.enabled else {
            commandLogger.warning("Topic subscription requested but notifications are disabled in config")
            delegate?.sendJSONCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: [
                "success": false,
                "error": "Notifications disabled in configuration",
                "action": "subscribe"
            ])
            return
        }

        guard let configString = configString,
              let data = configString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let topic = json["topic"] as? String else {
            commandLogger.error("Invalid topic subscription configuration")
            delegate?.sendJSONCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: [
                "success": false,
                "error": "Invalid topic configuration"
            ])
            return
        }

        commandLogger.debug("Subscribing to topic: \(topic)")

        Task { [weak self, topic] in
            guard let self else { return }
            let success = await self.notificationHandler.subscribeToTopic(topic)

            await MainActor.run {
                guard let delegate = self.delegate else {
                    commandLogger.debug("Delegate released before TOPIC_SUBSCRIPTION_RESULT (subscribe) callback")
                    return
                }
                delegate.sendJSONCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: [
                    "topic": topic,
                    "success": success,
                    "action": "subscribe"
                ])
            }
        }
    }

    func unsubscribeFromTopic(_ configString: String?) {
        // Check if notifications are enabled in config
        guard ConfigConstants.Notifications.enabled else {
            commandLogger.warning("Topic unsubscription requested but notifications are disabled in config")
            delegate?.sendJSONCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: [
                "success": false,
                "error": "Notifications disabled in configuration",
                "action": "unsubscribe"
            ])
            return
        }

        guard let configString = configString,
              let data = configString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let topic = json["topic"] as? String else {
            commandLogger.error("Invalid topic unsubscription configuration")
            delegate?.sendJSONCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: [
                "success": false,
                "error": "Invalid topic configuration"
            ])
            return
        }

        commandLogger.debug("Unsubscribing from topic: \(topic)")

        Task { [weak self, topic] in
            guard let self else { return }
            let success = await self.notificationHandler.unsubscribeFromTopic(topic)

            await MainActor.run {
                guard let delegate = self.delegate else {
                    commandLogger.debug("Delegate released before TOPIC_SUBSCRIPTION_RESULT (unsubscribe) callback")
                    return
                }
                delegate.sendJSONCallback(eventName: "TOPIC_SUBSCRIPTION_RESULT", data: [
                    "topic": topic,
                    "success": success,
                    "action": "unsubscribe"
                ])
            }
        }
    }

    func getSubscribedTopics() {
        // Check if notifications are enabled in config
        guard ConfigConstants.Notifications.enabled else {
            commandLogger.warning("Get subscribed topics requested but notifications are disabled in config")
            delegate?.sendJSONCallback(eventName: "SUBSCRIBED_TOPICS_RESULT", data: [
                "topics": [],
                "success": false,
                "error": "Notifications disabled in configuration"
            ])
            return
        }

        commandLogger.debug("Getting subscribed topics")

        Task { [weak self] in
            guard let self else { return }
            let topics = await self.notificationHandler.getSubscribedTopics()

            await MainActor.run {
                guard let delegate = self.delegate else {
                    commandLogger.debug("Delegate released before SUBSCRIBED_TOPICS_RESULT callback")
                    return
                }
                delegate.sendJSONCallback(eventName: "SUBSCRIBED_TOPICS_RESULT", data: [
                    "topics": topics,
                    "success": true
                ])
            }
        }
    }

    // MARK: - Helpers

    private func resolvePresentingViewController() -> UIViewController? {
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            if let window = scene.windows.first(where: { $0.isKeyWindow }),
               let rootVC = window.rootViewController {
                return rootVC.presentedViewController ?? rootVC
            }
        }

        return viewController
    }

    private func configureGoogleSignIn(clientId: String) {
        let iosClientId = ConfigConstants.GoogleSignIn.iosClientId
        let serverClientId = clientId  // This is the Web Client ID
        let configClientId = !iosClientId.isEmpty ? iosClientId : serverClientId

        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: configClientId,
            serverClientID: serverClientId
        )

        if !hasAttemptedGoogleRestore {
            hasAttemptedGoogleRestore = true
            GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
                if let error = error {
                    commandLogger.debug("Google Sign-In restore failed: \(error.localizedDescription)")
                } else if user != nil {
                    commandLogger.debug("Google Sign-In restored previous session")
                } else {
                    commandLogger.debug("Google Sign-In restore found no previous user")
                }
            }
        }
    }

    private func isCancelledGoogleError(_ error: NSError) -> Bool {
        let description = error.localizedDescription.lowercased()
        if description.contains("cancel") {
            return true
        }

        // GIDSignIn cancellation historically uses code -5; keep the check resilient
        if error.code == -5 {
            return true
        }

        return false
    }
}
