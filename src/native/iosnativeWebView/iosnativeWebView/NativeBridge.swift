//
//  NativeBridge.swift
//  iosnativeWebView
//
//  Created by Mayank Mahavar on 19/03/25.
//
import Foundation
import WebKit
import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NativeBridge")

class NativeBridge: NSObject, ImageHandlerDelegate, FilePickerHandlerDelegate {
    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    private let imageHandler = ImageHandler()
    private let filePickerHandler = FilePickerHandler()

    init(webView: WKWebView, viewController: UIViewController) {
        self.webView = webView
        self.viewController = viewController
        super.init()

        imageHandler.delegate = self
        filePickerHandler.delegate = self
        iosnativeWebView.logger.debug("NativeBridge initialized")
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
    
    
    // Helper function to run JavaScript in the WebView
    private func evaluateJavaScript(_ script: String) {
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(script) { result, error in
                if let error = error {
                    iosnativeWebView.logger.error("Error executing JavaScript: \(error.localizedDescription)")
                }
            }
        }
    }
    
    // Legacy helper function for backward compatibility - converts string to JSON format
    private func sendCallback(eventName: String, data: String = "") {
        sendJSONCallback(eventName: eventName, data: ["message": data])
    }

    // Primary helper function to send structured JSON data back to WebView
    // Uses proper JSON serialization to prevent injection vulnerabilities
    private func sendJSONCallback(eventName: String, data: [String: Any]) {
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: data, options: [])
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                let script = "window.WebBridge.callback('\(eventName)', \(jsonString))"
                evaluateJavaScript(script)
            } else {
                iosnativeWebView.logger.error("Failed to convert JSON data to string for event: \(eventName)")
                sendErrorCallback(eventName: eventName, error: "Failed to serialize callback data", code: "JSON_SERIALIZATION_ERROR")
            }
        } catch {
            iosnativeWebView.logger.error("Failed to serialize JSON for event \(eventName): \(error.localizedDescription)")
            sendErrorCallback(eventName: eventName, error: "JSON serialization failed", code: "JSON_SERIALIZATION_ERROR")
        }
    }

    // Helper function to send standardized error responses with consistent JSON format
    // Includes error details, error codes, timestamps and platform identification
    private func sendErrorCallback(eventName: String, error: String, code: String = "UNKNOWN_ERROR") {
        let errorData: [String: Any] = [
            "error": error,
            "code": code,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "platform": "ios"
        ]

        do {
            let jsonData = try JSONSerialization.data(withJSONObject: errorData, options: [])
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                let script = "window.WebBridge.callback('\(eventName)', \(jsonString))"
                evaluateJavaScript(script)
            } else {
                // Fallback to basic error if JSON serialization fails
                let fallbackScript = "window.WebBridge.callback('\(eventName)', '{\"error\":\"\(error)\",\"code\":\"\(code)\"}')"
                evaluateJavaScript(fallbackScript)
            }
        } catch {
            // Ultimate fallback
            let fallbackScript = "window.WebBridge.callback('\(eventName)', '{\"error\":\"\(error)\",\"code\":\"\(code)\"}')"
            evaluateJavaScript(fallbackScript)
        }
    }
    
    // Open camera and capture image
    @objc func openCamera() {
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
            iosnativeWebView.logger.error("No valid view controller available")
            sendErrorCallback(eventName: "ON_CAMERA_ERROR", error: "No valid view controller available", code: "VIEW_CONTROLLER_UNAVAILABLE")
            return
        }
        
        imageHandler.checkCameraPermission { [weak self] granted in
            guard let self = self else { return }
            
            if granted {
                self.imageHandler.presentCamera(from: presentingVC)
            } else {
                iosnativeWebView.logger.error("Camera permission denied")
                self.sendJSONCallback(eventName: "CAMERA_PERMISSION_STATUS", data: ["status": "DENIED"])
                self.imageHandler.presentPermissionAlert(from: presentingVC)
            }
        }
    }
    
    @objc func requestCameraPermission() {
        iosnativeWebView.logger.debug("Camera permission requested")
        
        imageHandler.checkCameraPermission { [weak self] granted in
            guard let self = self else { return }
            
            let permissionStatus = granted ? "GRANTED" : "DENIED"
            iosnativeWebView.logger.debug("Camera permission status: \(permissionStatus)")
            
            self.sendJSONCallback(eventName: "CAMERA_PERMISSION_STATUS", data: ["status": permissionStatus])
        }
    }
    
    // Get device information
    @objc func getDeviceInfo() {
        iosnativeWebView.logger.debug("getDeviceInfo called")

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

        sendJSONCallback(eventName: "ON_DEVICE_INFO_SUCCESS", data: deviceInfo)
    }

    // Log message (test function)
    @objc func logger() {
        iosnativeWebView.logger.debug("Message from native")
        sendCallback(eventName: "ON_LOGGER", data: "From native, with regards")
    }

    // Pick file from device storage
    @objc func pickFile(mimeType: String = "*/*") {
        iosnativeWebView.logger.debug("pickFile called with mimeType: \(mimeType)")

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
            iosnativeWebView.logger.error("No valid view controller available")
            sendErrorCallback(eventName: "ON_FILE_PICK_ERROR", error: "No valid view controller available", code: "VIEW_CONTROLLER_UNAVAILABLE")
            return
        }

        filePickerHandler.presentFilePicker(from: presentingVC, mimeType: mimeType)
    }
    
    // MARK: - ImageHandlerDelegate
    func imageHandler(_ handler: ImageHandler, didCaptureImageAt url: URL) {
        // Create JSON response with file URL
        iosnativeWebView.logger.debug("Image captured successfully at: \(url.absoluteString)")
        sendJSONCallback(eventName: "ON_CAMERA_CAPTURE", data: ["imageUrl": url.absoluteString])
    }
    
    func imageHandlerDidCancel(_ handler: ImageHandler) {
        iosnativeWebView.logger.debug("Camera capture cancelled")
        sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Cancelled")
    }
    
    func imageHandler(_ handler: ImageHandler, didFailWithError error: Error) {
        iosnativeWebView.logger.error("Camera error: \(error.localizedDescription)")
        sendErrorCallback(eventName: "ON_CAMERA_ERROR", error: error.localizedDescription, code: "CAMERA_ERROR")
    }
}

// MARK: - FilePickerHandlerDelegate
extension NativeBridge {
    func filePickerHandler(_ handler: FilePickerHandler, didPickFileAt url: URL, withMetadata metadata: FileMetadata) {
        iosnativeWebView.logger.debug("File picked: \(metadata.fileName)")

        // Process the file using the same tri-transport logic as Android
        let result = processFileForWebView(url: url, metadata: metadata)

        if result.success {
            // Create JSON response matching Android format
            let json: [String: Any] = [
                "fileName": result.fileName,
                "fileSrc": result.fileSrc ?? "",
                "size": result.fileSize,
                "mimeType": result.mimeType,
                "transport": result.transport.name,
                "source": "file_picker"
            ]

            iosnativeWebView.logger.debug("File processed successfully via \(result.transport.name): \(result.fileName)")
            sendJSONCallback(eventName: "ON_FILE_PICKED", data: json)
        } else {
            let errorMessage = result.error ?? "Unknown error processing file"
            iosnativeWebView.logger.error("File processing failed: \(errorMessage)")
            sendErrorCallback(eventName: "ON_FILE_PICK_ERROR", error: errorMessage, code: "FILE_PROCESSING_ERROR")
        }
    }

    func filePickerHandlerDidCancel(_ handler: FilePickerHandler) {
        iosnativeWebView.logger.debug("File picker cancelled")
        sendCallback(eventName: "ON_FILE_PICK_CANCELLED", data: "File selection cancelled")
    }

    func filePickerHandler(_ handler: FilePickerHandler, didFailWithError error: Error) {
        iosnativeWebView.logger.error("File picker error: \(error.localizedDescription)")
        sendErrorCallback(eventName: "ON_FILE_PICK_ERROR", error: error.localizedDescription, code: "FILE_PICKER_ERROR")
    }

    func filePickerHandler(_ handler: FilePickerHandler, stateDidChange state: String) {
        iosnativeWebView.logger.debug("File picker state: \(state)")

        sendJSONCallback(eventName: "ON_FILE_PICK_STATE_UPDATE", data: ["state": state])
    }

    // Helper method to process file for WebView using FilePickerHandler's logic
    private func processFileForWebView(url: URL, metadata: FileMetadata) -> FileProcessingResult {
        // Use FilePickerHandler's existing file processing logic to avoid duplication
        return filePickerHandler.processFile(at: url, metadata: metadata)
    }

    // Helper method to extract MIME type from various parameter formats
    private func extractMimeType(from params: Any?) -> String {
        // Default fallback
        let defaultMimeType = "*/*"

        // Handle direct string parameter
        if let directString = params as? String {
            iosnativeWebView.logger.debug("Extracted MIME type from direct string: \(directString)")
            return directString.isEmpty ? defaultMimeType : directString
        }

        // Handle nested dictionary parameter
        if let paramsDict = params as? [String: Any] {
            if let dataString = paramsDict["data"] as? String {
                iosnativeWebView.logger.debug("Extracted MIME type from nested data: \(dataString)")
                return dataString.isEmpty ? defaultMimeType : dataString
            }

            // Check for other possible keys
            if let mimeTypeString = paramsDict["mimeType"] as? String {
                iosnativeWebView.logger.debug("Extracted MIME type from mimeType key: \(mimeTypeString)")
                return mimeTypeString.isEmpty ? defaultMimeType : mimeTypeString
            }
        }

        // Fallback for unsupported parameter formats
        iosnativeWebView.logger.warning("Unable to extract MIME type from params: \(String(describing: params)), using default: \(defaultMimeType)")
        return defaultMimeType
    }
}

// MARK: - WKScriptMessageHandler
extension NativeBridge: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Enhanced validation
        guard let validatedMessage = validateMessage(message) else {
            return
        }

        let body = validatedMessage.body
        let command = validatedMessage.command
        let params = validatedMessage.params

        iosnativeWebView.logger.debug("Received validated command: \(command)")

        // Execute commands with proper error handling
        executeCommand(command, params: params)
    }

    // Enhanced message validation to prevent malicious or malformed messages
    // Validates message structure, command presence, and command authorization
    private func validateMessage(_ message: WKScriptMessage) -> (body: [String: Any], command: String, params: Any?)? {
        // Validate message name
        guard message.name == "NativeBridge" else {
            iosnativeWebView.logger.error("Invalid message handler name: \(message.name)")
            return nil
        }

        // Validate message body structure
        guard let body = message.body as? [String: Any] else {
            iosnativeWebView.logger.error("Invalid message format - body is not a dictionary")
            return nil
        }

        // Validate command presence and type
        guard let command = body["command"] as? String, !command.isEmpty else {
            iosnativeWebView.logger.error("Invalid or missing command in message")
            return nil
        }

        // Validate command is supported
        let supportedCommands = ["openCamera", "requestCameraPermission", "getDeviceInfo", "logger", "pickFile"]
        guard supportedCommands.contains(command) else {
            iosnativeWebView.logger.error("Unsupported command: \(command)")
            return nil
        }

        let params = body["data"]

        iosnativeWebView.logger.debug("Message validation successful for command: \(command)")
        return (body: body, command: command, params: params)
    }

    // Secure command execution with comprehensive error handling
    // All native functionality is accessed through this controlled entry point
    private func executeCommand(_ command: String, params: Any?) {
        do {
            switch command {
            case "openCamera":
                openCamera()
            case "requestCameraPermission":
                requestCameraPermission()
            case "getDeviceInfo":
                getDeviceInfo()
            case "logger":
                logger()
            case "pickFile":
                let mimeType = extractMimeType(from: params)
                pickFile(mimeType: mimeType)
            default:
                // This should never happen due to validation, but keeping for safety
                iosnativeWebView.logger.error("Unexpected command reached execution: \(command)")
            }
        } catch {
            iosnativeWebView.logger.error("Error executing command \(command): \(error.localizedDescription)")
        }
    }
}
