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

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NativeBridge")

class NativeBridge: NSObject, BridgeCommandHandlerDelegate, BridgeFileHandlerDelegate, BridgeDelegateHandlerDelegate {
    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    private let imageHandler = ImageHandler()
    private let filePickerHandler = FilePickerHandler()

    // JavaScript communication interface
    private let jsInterface: BridgeJavaScriptInterface

    // Native command handler
    private let commandHandler: BridgeCommandHandler

    // File operations handler
    private let fileHandler: BridgeFileHandler

    // Delegate handler for ImageHandler and FilePickerHandler callbacks
    private let delegateHandler: BridgeDelegateHandler

    init(webView: WKWebView, viewController: UIViewController) {
        self.webView = webView
        self.viewController = viewController
        self.jsInterface = BridgeJavaScriptInterface(webView: webView)
        self.commandHandler = BridgeCommandHandler(viewController: viewController, imageHandler: imageHandler, filePickerHandler: filePickerHandler)
        self.fileHandler = BridgeFileHandler(viewController: viewController)
        self.delegateHandler = BridgeDelegateHandler(filePickerHandler: filePickerHandler)
        super.init()

        imageHandler.delegate = delegateHandler
        filePickerHandler.delegate = delegateHandler
        commandHandler.setDelegate(self)
        fileHandler.setDelegate(self)
        delegateHandler.setDelegate(self)
        iosnativeWebView.logger.debug("NativeBridge initialized with JavaScript interface, command handler, file handler, and delegate handler")
    }

    deinit {
        unregister()
        iosnativeWebView.logger.debug("NativeBridge deallocated")
    }
    
    // Register the JavaScript interface with the WebView
    func register() {
        let userContentController = webView?.configuration.userContentController
        userContentController?.add(self, name: "NativeBridge")
        
        iosnativeWebView.logger.debug("NativeBridge registered - platform detection handled by NativeBridge.js utility")
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
        iosnativeWebView.logger.debug("Received validated command: \(command)")

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
                let mimeType = delegateHandler.extractMimeType(from: params)
                commandHandler.pickFile(mimeType: mimeType)
            case "openFileWithIntent":
                fileHandler.openFileWithIntent(params: params)
            case "requestHapticFeedback":
                let feedbackType = delegateHandler.extractFeedbackType(from: params)
                commandHandler.requestHapticFeedback(feedbackType: feedbackType)
            default:
                // This should never happen due to validation, but keeping for safety
                iosnativeWebView.logger.error("Unexpected command reached execution: \(command)")
            }
        } catch {
            iosnativeWebView.logger.error("Error executing command \(command): \(error.localizedDescription)")
        }
    }
}
