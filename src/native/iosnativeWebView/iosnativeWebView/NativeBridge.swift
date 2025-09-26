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
    private var documentInteractionController: UIDocumentInteractionController?
    private var downloadTask: URLSessionDownloadTask?

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
    
    // Request haptic feedback
    @objc func requestHapticFeedback(feedbackType: String = "VIRTUAL_KEY") {
        iosnativeWebView.logger.debug("requestHapticFeedback called with type: \(feedbackType)")
        
        // Check if device supports haptics (iOS 10+)
        guard #available(iOS 10.0, *) else {
            iosnativeWebView.logger.warning("Haptic feedback not supported on this iOS version")
            sendErrorCallback(eventName: "HAPTIC_FEEDBACK", error: "Haptic feedback not supported on this iOS version", code: "HAPTIC_NOT_SUPPORTED")
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
                iosnativeWebView.logger.debug("Unknown haptic type '\(type)', using default (.light)")
                feedbackGenerator = UIImpactFeedbackGenerator(style: .light)
            }
            
            // Prepare and trigger haptic feedback
            feedbackGenerator.prepare()
            feedbackGenerator.impactOccurred()
            
            iosnativeWebView.logger.debug("Haptic feedback performed: \(type)")
            self.sendJSONCallback(eventName: "HAPTIC_FEEDBACK", data: [
                "status": "success",
                "type": type,
                "platform": "ios"
            ])
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

    // Open file with external app using intent (iOS equivalent of Android intent)
    @objc func openFileWithIntent(params: Any?) {
        iosnativeWebView.logger.debug("openFileWithIntent called with params: \(String(describing: params))")

        // Extract parameter string
        let paramsString: String?
        if let directString = params as? String {
            paramsString = directString
        } else if let paramsDict = params as? [String: Any], let dataString = paramsDict["data"] as? String {
            paramsString = dataString
        } else {
            paramsString = nil
        }

        guard let paramStr = paramsString, !paramStr.isEmpty else {
            iosnativeWebView.logger.error("Intent parameters cannot be empty")
            sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Intent parameters cannot be empty", code: "INVALID_PARAMETERS")
            return
        }

        // Parse "fileUrl|mimeType" format
        let components = paramStr.components(separatedBy: "|")
        let fileUrl = components[0].trimmingCharacters(in: .whitespacesAndNewlines)
        let mimeType = components.count > 1 ? components[1].trimmingCharacters(in: .whitespacesAndNewlines) : nil

        guard !fileUrl.isEmpty else {
            iosnativeWebView.logger.error("File URL cannot be empty")
            sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "File URL cannot be empty", code: "INVALID_FILE_URL")
            return
        }

        iosnativeWebView.logger.debug("Processing intent for file: \(fileUrl), mimeType: \(mimeType ?? "auto-detect")")

        // Validate URL scheme
        guard fileUrl.hasPrefix("http://") || fileUrl.hasPrefix("https://") || fileUrl.hasPrefix("file://") else {
            iosnativeWebView.logger.error("Unsupported URL scheme for file: \(fileUrl)")
            sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Only remote URLs (http/https) and file URLs are supported", code: "INVALID_URL_SCHEME")
            return
        }

        // Validate URL format
        guard URL(string: fileUrl) != nil else {
            iosnativeWebView.logger.error("Invalid URL format: \(fileUrl)")
            sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Invalid URL format", code: "INVALID_URL")
            return
        }

        iosnativeWebView.logger.debug("URL validation successful")

        // Handle remote URLs by downloading first
        if fileUrl.hasPrefix("http://") || fileUrl.hasPrefix("https://") {
            downloadFile(urlString: fileUrl, mimeType: mimeType)
        } else if fileUrl.hasPrefix("file://") {
            // Handle local file URLs (for future implementation)
            sendJSONCallback(eventName: "ON_INTENT_SUCCESS", data: [
                "message": "Local file URLs not yet implemented",
                "fileUrl": fileUrl,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "platform": "ios"
            ])
        }
    }

    // Download remote file for intent operations
    private func downloadFile(urlString: String, mimeType: String?) {
        guard let url = URL(string: urlString) else {
            iosnativeWebView.logger.error("Invalid URL: \(urlString)")
            sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Invalid URL", code: "INVALID_URL")
            return
        }

        iosnativeWebView.logger.debug("Starting download from: \(urlString)")

        // Create a download task
        let session = URLSession.shared
        downloadTask = session.downloadTask(with: url) { [weak self] localURL, response, error in
            guard let self = self else { return }

            if let error = error {
                if (error as NSError).code == NSURLErrorCancelled {
                    iosnativeWebView.logger.debug("Download cancelled by user")
                    self.sendCallback(eventName: "ON_INTENT_CANCELLED", data: "Download cancelled")
                    return
                }
                iosnativeWebView.logger.error("Download failed: \(error.localizedDescription)")
                self.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Download failed: \(error.localizedDescription)", code: "DOWNLOAD_ERROR")
                return
            }

            guard let localURL = localURL else {
                iosnativeWebView.logger.error("Download completed but no local file URL")
                self.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Download completed but no local file URL", code: "DOWNLOAD_ERROR")
                return
            }

            // Check file size (100MB limit like Android)
            do {
                let fileSize = try FileManager.default.attributesOfItem(atPath: localURL.path)[.size] as? Int64 ?? 0
                let maxSizeBytes: Int64 = 100 * 1024 * 1024 // 100MB

                if fileSize > maxSizeBytes {
                    iosnativeWebView.logger.error("File too large: \(fileSize) bytes (max: \(maxSizeBytes) bytes)")
                    self.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "File too large (max: 100MB)", code: "FILE_TOO_LARGE")
                    return
                }
            } catch {
                iosnativeWebView.logger.error("Error checking file size: \(error.localizedDescription)")
            }

            // Move the downloaded file to Documents directory
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let fileName = response?.suggestedFilename ?? url.lastPathComponent
            let destinationURL = documentsPath.appendingPathComponent(fileName)

            do {
                // Remove existing file if it exists
                if FileManager.default.fileExists(atPath: destinationURL.path) {
                    try FileManager.default.removeItem(at: destinationURL)
                }

                // Move downloaded file to permanent location
                try FileManager.default.moveItem(at: localURL, to: destinationURL)

                // Set proper file permissions
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destinationURL.path)

                iosnativeWebView.logger.debug("File downloaded successfully to: \(destinationURL.path)")

                // Open the downloaded file with external app
                DispatchQueue.main.async {
                    self.openFileWithExternalApp(fileURL: destinationURL, mimeType: mimeType)
                }

            } catch {
                iosnativeWebView.logger.error("Failed to move downloaded file: \(error.localizedDescription)")
                self.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Failed to process downloaded file", code: "FILE_PROCESSING_ERROR")
            }
        }

        downloadTask?.resume()
    }

    // Helper method to find the top view controller
    private func findTopViewController() -> UIViewController? {
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = scene.windows.first?.rootViewController {
            // Use the root view controller or find a presented controller
            return rootVC.presentedViewController ?? rootVC
        } else {
            // Fallback to the provided viewController
            return viewController
        }
    }

    // Open file with external app using UIDocumentInteractionController
    private func openFileWithExternalApp(fileURL: URL, mimeType: String?) {
        iosnativeWebView.logger.debug("Opening file with external app: \(fileURL.lastPathComponent)")

        // Find a valid UIViewController using helper method
        guard let viewController = findTopViewController() else {
            iosnativeWebView.logger.error("No valid view controller available")
            sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "No valid view controller available", code: "VIEW_CONTROLLER_ERROR")
            return
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            iosnativeWebView.logger.error("File does not exist: \(fileURL.path)")
            sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "File does not exist", code: "FILE_NOT_FOUND")
            return
        }

        // Create document interaction controller
        documentInteractionController = UIDocumentInteractionController(url: fileURL)
        documentInteractionController?.delegate = self

        // Try to present open-in menu
        let presented = documentInteractionController?.presentOpenInMenu(from: viewController.view.bounds, in: viewController.view, animated: true) ?? false

        if !presented {
            iosnativeWebView.logger.info("No apps available for open-in menu, trying sharing sheet")
            presentSharingSheet(for: fileURL)
        } else {
            iosnativeWebView.logger.debug("Open-in menu presented successfully")
        }
    }

    // Present sharing sheet as fallback
    private func presentSharingSheet(for fileURL: URL) {
        // Find a valid UIViewController using helper method
        guard let viewController = findTopViewController() else {
            iosnativeWebView.logger.error("No valid view controller available for sharing sheet")
            sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Unable to present sharing options", code: "VIEW_CONTROLLER_ERROR")
            return
        }

        let shareController = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)

        // Configure for iPad
        if let popoverController = shareController.popoverPresentationController {
            popoverController.sourceView = viewController.view
            popoverController.sourceRect = CGRect(x: UIScreen.main.bounds.midX, y: UIScreen.main.bounds.midY, width: 0, height: 0)
            popoverController.permittedArrowDirections = []
        }

        shareController.completionWithItemsHandler = { [weak self] activityType, completed, returnedItems, error in
            if let error = error {
                iosnativeWebView.logger.error("Sharing failed: \(error.localizedDescription)")
                self?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Sharing failed: \(error.localizedDescription)", code: "SHARING_ERROR")
            } else if completed {
                iosnativeWebView.logger.debug("File shared/opened successfully")
                self?.sendJSONCallback(eventName: "ON_INTENT_SUCCESS", data: [
                    "message": "File opened successfully",
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                    "platform": "ios"
                ])
            } else {
                iosnativeWebView.logger.debug("Sharing cancelled by user")
                self?.sendJSONCallback(eventName: "ON_INTENT_CANCELLED", data: [
                    "message": "File opening cancelled",
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                    "platform": "ios"
                ])
            }
        }

        viewController.present(shareController, animated: true)
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
    
    // Helper method to extract feedback type from various parameter formats
    private func extractFeedbackType(from params: Any?) -> String {
        // Default fallback matching Android implementation
        let defaultFeedbackType = "VIRTUAL_KEY"

        // Handle direct string parameter
        if let directString = params as? String {
            iosnativeWebView.logger.debug("Extracted feedback type from direct string: \(directString)")
            return directString.isEmpty ? defaultFeedbackType : directString
        }

        // Handle nested dictionary parameter
        if let paramsDict = params as? [String: Any] {
            if let dataString = paramsDict["data"] as? String {
                iosnativeWebView.logger.debug("Extracted feedback type from nested data: \(dataString)")
                return dataString.isEmpty ? defaultFeedbackType : dataString
            }

            // Check for other possible keys
            if let feedbackTypeString = paramsDict["feedbackType"] as? String {
                iosnativeWebView.logger.debug("Extracted feedback type from feedbackType key: \(feedbackTypeString)")
                return feedbackTypeString.isEmpty ? defaultFeedbackType : feedbackTypeString
            }
        }

        // Fallback for unsupported parameter formats
        iosnativeWebView.logger.warning("Unable to extract feedback type from params: \(String(describing: params)), using default: \(defaultFeedbackType)")
        return defaultFeedbackType
    }
}

// MARK: - UIDocumentInteractionControllerDelegate
extension NativeBridge: UIDocumentInteractionControllerDelegate {

    func documentInteractionControllerViewControllerForPreview(_ controller: UIDocumentInteractionController) -> UIViewController {
        return viewController ?? UIViewController()
    }

    func documentInteractionController(_ controller: UIDocumentInteractionController, willBeginSendingToApplication application: String?) {
        iosnativeWebView.logger.debug("Will begin sending to application: \(application ?? "unknown")")
    }

    func documentInteractionController(_ controller: UIDocumentInteractionController, didEndSendingToApplication application: String?) {
        iosnativeWebView.logger.debug("Did end sending to application: \(application ?? "unknown")")
        sendJSONCallback(eventName: "ON_INTENT_SUCCESS", data: [
            "message": "File opened successfully with \(application ?? "external app")",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "platform": "ios"
        ])
    }

    func documentInteractionControllerDidDismissOpenInMenu(_ controller: UIDocumentInteractionController) {
        iosnativeWebView.logger.debug("Open-in menu dismissed")
        sendJSONCallback(eventName: "ON_INTENT_CANCELLED", data: [
            "message": "File opening cancelled",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "platform": "ios"
        ])
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
        let supportedCommands = ["openCamera", "requestCameraPermission", "getDeviceInfo", "logger", "pickFile", "openFileWithIntent", "requestHapticFeedback"]
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
            case "openFileWithIntent":
                openFileWithIntent(params: params)
            case "requestHapticFeedback":
                let feedbackType = extractFeedbackType(from: params)
                requestHapticFeedback(feedbackType: feedbackType)
            default:
                // This should never happen due to validation, but keeping for safety
                iosnativeWebView.logger.error("Unexpected command reached execution: \(command)")
            }
        } catch {
            iosnativeWebView.logger.error("Error executing command \(command): \(error.localizedDescription)")
        }
    }
}
