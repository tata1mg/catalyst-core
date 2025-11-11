//
//  BridgeDelegateHandler.swift
//  iosnativeWebView
//
//  Delegate handler for WebView bridge
//  Extracted from NativeBridge.swift for better separation of concerns
//

import Foundation
import UIKit
import os

private let delegateLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: CatalystConstants.Logging.Categories.delegateHandler)

// MARK: - Delegate Handler Communication Protocol

protocol BridgeDelegateHandlerDelegate: AnyObject {
    func sendJSONCallback(eventName: String, data: [String: Any])
    func sendErrorCallback(eventName: String, error: String, code: String)
    func sendCallback(eventName: String, data: String)
}

// MARK: - Bridge Delegate Handler

class BridgeDelegateHandler: NSObject {

    private weak var delegate: BridgeDelegateHandlerDelegate?
    private let filePickerHandler: FilePickerHandler

    init(filePickerHandler: FilePickerHandler) {
        self.filePickerHandler = filePickerHandler
        super.init()
        delegateLogger.debug("BridgeDelegateHandler initialized")
    }

    deinit {
        delegateLogger.debug("BridgeDelegateHandler deallocated")
    }

    // MARK: - Delegate Management

    func setDelegate(_ delegate: BridgeDelegateHandlerDelegate) {
        self.delegate = delegate
    }

    // MARK: - Helper Methods for Parameter Extraction

    // Helper method to extract string parameter from various formats
    func extractStringParam(from params: Any?) -> String? {
        // Handle direct string parameter
        if let directString = params as? String {
            return directString.isEmpty ? nil : directString
        }

        // Handle nested dictionary parameter
        if let paramsDict = params as? [String: Any] {
            if let dataString = paramsDict["data"] as? String {
                return dataString.isEmpty ? nil : dataString
            }
        }

        return nil
    }

    // Helper method to extract feedback type from various parameter formats
    func extractFeedbackType(from params: Any?) -> String {
        // Default fallback matching Android implementation
        let defaultFeedbackType = "VIRTUAL_KEY"

        // Handle direct string parameter
        if let directString = params as? String {
            delegateLogger.debug("Extracted feedback type from direct string: \(directString)")
            return directString.isEmpty ? defaultFeedbackType : directString
        }

        // Handle nested dictionary parameter
        if let paramsDict = params as? [String: Any] {
            if let dataString = paramsDict["data"] as? String {
                delegateLogger.debug("Extracted feedback type from nested data: \(dataString)")
                return dataString.isEmpty ? defaultFeedbackType : dataString
            }

            // Check for other possible keys
            if let feedbackTypeString = paramsDict["feedbackType"] as? String {
                delegateLogger.debug("Extracted feedback type from feedbackType key: \(feedbackTypeString)")
                return feedbackTypeString.isEmpty ? defaultFeedbackType : feedbackTypeString
            }
        }

        // Fallback for unsupported parameter formats
        delegateLogger.warning("Unable to extract feedback type from params: \(String(describing: params)), using default: \(defaultFeedbackType)")
        return defaultFeedbackType
    }

}

// MARK: - ImageHandlerDelegate

extension BridgeDelegateHandler: ImageHandlerDelegate {
    func imageHandler(_ handler: ImageHandler, didCaptureImageAt url: URL, withOptions options: [String: Any]) {
        delegateLogger.debug("Image captured successfully at: \(url.absoluteString)")

        // Use tri-transport architecture to process the captured image
        let transportDecision = CameraTransportUtils.determineTransport(for: url)
        delegateLogger.info("Camera transport decision: \(transportDecision.transportType.name) - \(transportDecision.reason)")

        let processingResult = CameraTransportUtils.processFile(decision: transportDecision, options: options)

        if processingResult.success {
            // Create rich response data matching Android format
            let resultData: [String: Any] = [
                "fileName": processingResult.fileName,
                "fileSrc": processingResult.fileSrc ?? "",
                "filePath": processingResult.filePath ?? "",
                "size": processingResult.fileSize,
                "mimeType": processingResult.mimeType,
                "transport": processingResult.transportUsed.name,
                "source": "camera",
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "platform": "ios"
            ]

            delegateLogger.info("Camera photo processed successfully via \(processingResult.transportUsed.name): \(processingResult.fileName)")
            delegate?.sendJSONCallback(eventName: "ON_CAMERA_CAPTURE", data: resultData)
        } else {
            let errorMessage = processingResult.error ?? "Unknown error processing camera photo"
            delegateLogger.error("Camera photo processing failed: \(errorMessage)")
            delegate?.sendErrorCallback(eventName: "ON_CAMERA_ERROR", error: errorMessage, code: "CAMERA_PROCESSING_ERROR")
        }
    }

    func imageHandlerDidCancel(_ handler: ImageHandler) {
        delegateLogger.debug("Camera capture cancelled")
        delegate?.sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Cancelled")
    }

    func imageHandler(_ handler: ImageHandler, didFailWithError error: Error) {
        delegateLogger.error("Camera error: \(error.localizedDescription)")
        delegate?.sendErrorCallback(eventName: "ON_CAMERA_ERROR", error: error.localizedDescription, code: "CAMERA_ERROR")
    }
}

// MARK: - FilePickerHandlerDelegate

extension BridgeDelegateHandler: FilePickerHandlerDelegate {
    func filePickerHandler(_ handler: FilePickerHandler, didFinishWith payload: [String: Any]) {
        let fileCount = (payload["count"] as? Int) ?? ((payload["files"] as? [Any])?.count ?? 1)
        delegateLogger.debug("File picker completed with \(fileCount) file(s)")
        delegate?.sendJSONCallback(eventName: "ON_FILE_PICKED", data: payload)
    }

    func filePickerHandlerDidCancel(_ handler: FilePickerHandler) {
        delegateLogger.debug("File picker cancelled")
        delegate?.sendCallback(eventName: "ON_FILE_PICK_CANCELLED", data: "File selection cancelled")
    }

    func filePickerHandler(_ handler: FilePickerHandler, didFailWithError error: Error) {
        delegateLogger.error("File picker error: \(error.localizedDescription)")
        delegate?.sendCallback(eventName: "ON_FILE_PICK_ERROR", data: error.localizedDescription)
    }

    func filePickerHandler(_ handler: FilePickerHandler, stateDidChange state: String) {
        delegateLogger.debug("File picker state: \(state)")
        delegate?.sendJSONCallback(eventName: "ON_FILE_PICK_STATE_UPDATE", data: ["state": state])
    }
}
