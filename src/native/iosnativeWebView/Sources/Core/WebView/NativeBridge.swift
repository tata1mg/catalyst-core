//
//  NativeBridge.swift
//  iosnativeWebView
//
//  Created by Mayank Mahavar on 19/03/25.
//
import Foundation
import WebKit
import UIKit
import AVFoundation
import os
import UserNotifications

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NativeBridge")

class NativeBridge: NSObject, BridgeCommandHandlerDelegate, BridgeFileHandlerDelegate, BridgeDelegateHandlerDelegate {
    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?

    // Protocol-based notification handler (injected at runtime)
    private var notificationHandler: NotificationHandlerProtocol = NullNotificationHandler.shared

    // Lazy initialization for non-critical handlers
    private lazy var imageHandler: ImageHandler = {
        logWithTimestamp("🔧 ImageHandler initialized (lazy)")
        return ImageHandler()
    }()

    private lazy var filePickerHandler: FilePickerHandler = {
        logWithTimestamp("🔧 FilePickerHandler initialized (lazy)")
        return FilePickerHandler()
    }()

    // JavaScript communication interface - critical, initialize immediately
    private let jsInterface: BridgeJavaScriptInterface

    // Native command handler - lazy init since it depends on image/file handlers
    private lazy var commandHandler: BridgeCommandHandler = {
        logWithTimestamp("🔧 BridgeCommandHandler initialized (lazy)")
        let handler = BridgeCommandHandler(
            viewController: viewController!,
            imageHandler: imageHandler,
            filePickerHandler: filePickerHandler
        )
        handler.setDelegate(self)
        // Pass the notification handler to command handler
        handler.setNotificationHandler(notificationHandler)
        return handler
    }()

    // File operations handler - lazy init
    private lazy var fileHandler: BridgeFileHandler = {
        logWithTimestamp("🔧 BridgeFileHandler initialized (lazy)")
        let handler = BridgeFileHandler(viewController: viewController!)
        handler.setDelegate(self)
        return handler
    }()

    // Delegate handler - lazy init
    private lazy var delegateHandler: BridgeDelegateHandler = {
        logWithTimestamp("🔧 BridgeDelegateHandler initialized (lazy)")
        let handler = BridgeDelegateHandler(filePickerHandler: filePickerHandler)
        imageHandler.delegate = handler
        filePickerHandler.delegate = handler
        handler.setDelegate(self)
        return handler
    }()

    init(webView: WKWebView, viewController: UIViewController) {
        let initStart = CFAbsoluteTimeGetCurrent()

        self.webView = webView
        self.viewController = viewController

        // Only initialize critical JS interface immediately
        self.jsInterface = BridgeJavaScriptInterface(webView: webView)

        super.init()

        setupNotificationNavigationHandler()

        let initTime = (CFAbsoluteTimeGetCurrent() - initStart) * 1000
        logWithTimestamp("⚡️ NativeBridge initialized (took \(String(format: "%.2f", initTime))ms, handlers deferred)")
    }

    deinit {
        unregister()
        logger.debug("NativeBridge deallocated")
    }

    /// Inject notification handler at runtime (called from WebView setup)
    func setNotificationHandler(_ handler: NotificationHandlerProtocol) {
        self.notificationHandler = handler
        setupNotificationNavigationHandler()

        // If commandHandler is already initialized, update it too
        // (Using @_borrowed to check without triggering lazy initialization)
        if case .some = Mirror(reflecting: self).children.first(where: { $0.label == "commandHandler" })?.value as? BridgeCommandHandler {
            commandHandler.setNotificationHandler(handler)
        }

        logger.info("Notification handler injected")
    }

    private func setupNotificationNavigationHandler() {
        notificationHandler.setNavigationHandler { [weak self] (url: URL) in
            DispatchQueue.main.async {
                guard let webView = self?.webView else {
                    logger.error("WebView not available for notification navigation")
                    return
                }
                let request = URLRequest(url: url)
                webView.load(request)
                logger.info("Navigating to notification URL: \(url.absoluteString)")
            }
        }
    }

    // Register the JavaScript interface with the WebView
    func register() {
        let registerStart = CFAbsoluteTimeGetCurrent()

        let userContentController = webView?.configuration.userContentController
        userContentController?.add(self, name: "NativeBridge")

        let registerTime = (CFAbsoluteTimeGetCurrent() - registerStart) * 1000
        logWithTimestamp("✅ NativeBridge registered (took \(String(format: "%.2f", registerTime))ms)")
    }
    
    // Unregister to prevent memory leaks
    func unregister() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "NativeBridge")
    }
    
    
    // MARK: - JavaScript Interface Delegation

    // Delegate JavaScript methods to the dedicated interface
    internal func sendCallback(eventName: String, data: String = "") {
        jsInterface.sendCallback(eventName: eventName, data: data)
    }

    // MARK: - BridgeCommandHandlerDelegate

    internal func sendStringCallback(eventName: String, data: String) {
        jsInterface.sendStringCallback(eventName: eventName, data: data)
    }

    internal func sendJSONCallback(eventName: String, data: [String: Any]) {
        jsInterface.sendJSONCallback(eventName: eventName, data: data)
    }

    internal func sendErrorCallback(eventName: String, error: String, code: String) {
        jsInterface.sendErrorCallback(eventName: eventName, error: error, code: code)
    }
    

    // MARK: - BridgeFileHandlerDelegate

    // File handler delegate methods are already implemented above in BridgeCommandHandlerDelegate
    // since both use the same sendJSONCallback, sendErrorCallback, and sendCallback methods
}

// MARK: - WKScriptMessageHandler
extension NativeBridge: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Use the new BridgeMessageValidator
        let validationResult = BridgeMessageValidator.validate(message: message)

        guard validationResult.isValid else {
            // Handle validation error
            if let error = validationResult.error {
                sendErrorCallback(eventName: error.eventName, error: error.message, code: error.code)
            }
            return
        }

        guard let command = validationResult.command else {
            sendErrorCallback(eventName: "BRIDGE_ERROR", error: "Missing command in validated message", code: "VALIDATION_ERROR")
            return
        }

        let params = validationResult.params
        logger.debug("Received validated command: \(command)")

        // Execute commands with proper error handling
        executeCommand(command, params: params)
    }

    // MARK: - Command Execution

    // Secure command execution with comprehensive error handling
    // All native functionality is accessed through this controlled entry point
    private func executeCommand(_ command: String, params: Any?) {
        do {
            switch command {
            case "openCamera":
                // Pass raw params - command handler will extract options
                let optionsString = delegateHandler.extractStringParam(from: params)
                commandHandler.openCamera(options: optionsString)
            case "requestCameraPermission":
                // Pass raw params - command handler will extract config
                let configString = delegateHandler.extractStringParam(from: params)
                commandHandler.requestCameraPermission(config: configString)
            case "getDeviceInfo":
                commandHandler.getDeviceInfo()
            case "logger":
                commandHandler.logger()
            case "pickFile":
                let optionsString = delegateHandler.extractStringParam(from: params)
                commandHandler.pickFile(options: optionsString)
            case "openFileWithIntent":
                fileHandler.openFileWithIntent(params: params)
            case "requestHapticFeedback":
                let feedbackType = delegateHandler.extractFeedbackType(from: params)
                commandHandler.requestHapticFeedback(feedbackType: feedbackType)

            // Notification commands (handled via protocol)
            case "requestNotificationPermission":
                commandHandler.requestNotificationPermission()
            case "scheduleLocalNotification":
                let config = delegateHandler.extractStringParam(from: params)
                commandHandler.scheduleLocalNotification(config)
            case "cancelLocalNotification":
                let notificationId = delegateHandler.extractStringParam(from: params)
                commandHandler.cancelLocalNotification(notificationId)
            case "registerForPushNotifications":
                commandHandler.registerForPushNotifications()
            case "subscribeToTopic":
                let config = delegateHandler.extractStringParam(from: params)
                commandHandler.subscribeToTopic(config)
            case "unsubscribeFromTopic":
                let config = delegateHandler.extractStringParam(from: params)
                commandHandler.unsubscribeFromTopic(config)
            case "getSubscribedTopics":
                commandHandler.getSubscribedTopics()
            default:
                // This should never happen due to validation, but keeping for safety
                logger.error("Unexpected command reached execution: \(command)")
            }
        } catch {
            logger.error("Error executing command \(command): \(error.localizedDescription)")
        }
    }
}
