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
    weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    private weak var webViewModel: WebViewModel?
    private var messageHandlerProxy: WeakScriptMessageHandler?
    private var isRegistered = false

    // Protocol-based notification handler (injected at runtime)
    private var notificationHandler: NotificationHandlerProtocol = NullNotificationHandler.shared
    private var networkStatusListenerId: UUID?

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
        handler.setNotificationHandler(notificationHandler)
        if let wv = webView { handler.setWebView(wv) }
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

    /// Inject WebViewModel at runtime (called from WebView setup)
    @MainActor
    func setWebViewModel(_ viewModel: WebViewModel) {
        self.webViewModel = viewModel

        // Set up callback for safe area updates
        viewModel.onSafeAreaUpdate = { [weak self] insets in
            self?.sendSafeAreaUpdate(insets)
        }

        logger.debug("WebViewModel set and safe area callback registered")
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
        guard !isRegistered else { return }
        let registerStart = CFAbsoluteTimeGetCurrent()

        guard let userContentController = webView?.configuration.userContentController else {
            return
        }
        let proxy = WeakScriptMessageHandler(delegate: self)
        userContentController.add(proxy, name: "NativeBridge")
        messageHandlerProxy = proxy
        isRegistered = true

        let registerTime = (CFAbsoluteTimeGetCurrent() - registerStart) * 1000
        logWithTimestamp("✅ NativeBridge registered (took \(String(format: "%.2f", registerTime))ms)")
    }
    
    // Unregister to prevent memory leaks
    func unregister() {
        guard isRegistered else { return }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "NativeBridge")
        messageHandlerProxy = nil
        isRegistered = false
        
        if let listenerId = networkStatusListenerId {
            NetworkMonitor.shared.removeListener(listenerId)
            networkStatusListenerId = nil
        }
    }

    private func startNetworkMonitoringIfNeeded() {
        guard networkStatusListenerId == nil else { return }

        networkStatusListenerId = NetworkMonitor.shared.addListener { [weak self] status in
            self?.sendNetworkStatusUpdate(status)
        }
    }

    private func sendNetworkStatusUpdate(_ status: NetworkStatus) {
        var payload: [String: Any] = ["online": status.isOnline]
        if let type = status.type {
            payload["type"] = type
        }

        sendJSONCallback(eventName: "NETWORK_STATUS_CHANGED", data: payload)
    }

    private func sendCurrentNetworkStatus() {
        startNetworkMonitoringIfNeeded()
        let status = NetworkMonitor.shared.currentStatus
        sendNetworkStatusUpdate(status)
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
        case "getNetworkStatus":
            sendCurrentNetworkStatus()
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
        case "googleSignIn":
            commandHandler.googleSignIn(params: params)

        // Notification commands (handled via protocol)
        case "requestNotificationPermission":
            commandHandler.requestNotificationPermission()
        case "checkNotificationPermissionStatus":
            commandHandler.checkNotificationPermissionStatus()
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
        case "getSafeArea":
            getSafeArea()
        case "setScreenSecure":
            commandHandler.setScreenSecure(params: params)
        case "getScreenSecure":
            commandHandler.getScreenSecure()
        case "clearWebData":
            commandHandler.clearWebData()
        default:
            // This should never happen due to validation, but keeping for safety
            logger.error("Unexpected command reached execution: \(command)")
        }
    }

    // MARK: - Safe Area Methods

    /// Get current safe area insets and send via callback
    /// Matches Android's NativeBridge.getSafeArea()
    private func getSafeArea() {
        Task { @MainActor in
            guard let viewModel = self.webViewModel else {
                logger.error("WebViewModel not set, cannot get safe area")
                sendErrorCallback(eventName: "ON_SAFE_AREA_INSETS_UPDATED", error: "WebViewModel not initialized", code: "VIEWMODEL_NOT_SET")
                return
            }

            let insets = viewModel.safeAreaInsets
            let data = insets.toDict()

            #if DEBUG
            logger.debug("📐 getSafeArea() called, returning: \(data)")
            #endif

            sendJSONCallback(eventName: "ON_SAFE_AREA_INSETS_UPDATED", data: data)
        }
    }

    /// Send safe area update notification to WebView
    /// Called when safe area insets change (e.g., post-layout calculation)
    /// Matches Android's MainActivity.notifySafeAreaUpdate()
    private func sendSafeAreaUpdate(_ insets: SafeAreaInsets) {
        let data = insets.toDict()

        #if DEBUG
        logger.info("🔄 Sending safe area update to WebView: \(data)")
        #endif

        sendJSONCallback(eventName: "ON_SAFE_AREA_INSETS_UPDATED", data: data)
    }
}
