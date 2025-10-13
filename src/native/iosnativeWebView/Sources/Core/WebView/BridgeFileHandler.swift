//
//  BridgeFileHandler.swift
//  iosnativeWebView
//
//  File operations handler for WebView bridge
//  Extracted from NativeBridge.swift for better separation of concerns
//

import Foundation
import UIKit
import os

private let fileLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: CatalystConstants.Logging.Categories.fileHandler)

// MARK: - File Handler Delegate

protocol BridgeFileHandlerDelegate: AnyObject {
    func sendJSONCallback(eventName: String, data: [String: Any])
    func sendErrorCallback(eventName: String, error: String, code: String)
    func sendCallback(eventName: String, data: String)
}

// MARK: - Bridge File Handler

class BridgeFileHandler: NSObject {

    private weak var viewController: UIViewController?
    private weak var delegate: BridgeFileHandlerDelegate?
    private var documentInteractionController: UIDocumentInteractionController?
    private var downloadTask: URLSessionDownloadTask?

    init(viewController: UIViewController) {
        self.viewController = viewController
        super.init()
        fileLogger.debug("BridgeFileHandler initialized")
    }

    deinit {
        downloadTask?.cancel()
        fileLogger.debug("BridgeFileHandler deallocated")
    }

    // MARK: - Delegate Management

    func setDelegate(_ delegate: BridgeFileHandlerDelegate) {
        self.delegate = delegate
    }

    // MARK: - File Intent Operations

    // Open file with external app using intent (iOS equivalent of Android intent)
    func openFileWithIntent(params: Any?) {
        fileLogger.debug("openFileWithIntent called with params: \(String(describing: params))")

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
            fileLogger.error("Intent parameters cannot be empty")
            delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Intent parameters cannot be empty", code: "INVALID_PARAMETERS")
            return
        }

        // Parse "fileUrl|mimeType" format
        let components = paramStr.components(separatedBy: "|")
        let fileUrl = components[0].trimmingCharacters(in: .whitespacesAndNewlines)
        let mimeType = components.count > 1 ? components[1].trimmingCharacters(in: .whitespacesAndNewlines) : nil

        guard !fileUrl.isEmpty else {
            fileLogger.error("File URL cannot be empty")
            delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "File URL cannot be empty", code: "INVALID_FILE_URL")
            return
        }

        fileLogger.debug("Processing intent for file: \(fileUrl), mimeType: \(mimeType ?? "auto-detect")")

        // Validate URL scheme
        guard fileUrl.hasPrefix("http://") || fileUrl.hasPrefix("https://") || fileUrl.hasPrefix("file://") else {
            fileLogger.error("Unsupported URL scheme for file: \(fileUrl)")
            delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Only remote URLs (http/https) and file URLs are supported", code: "INVALID_URL_SCHEME")
            return
        }

        // Validate URL format
        guard URL(string: fileUrl) != nil else {
            fileLogger.error("Invalid URL format: \(fileUrl)")
            delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Invalid URL format", code: "INVALID_URL")
            return
        }

        fileLogger.debug("URL validation successful")

        // Handle remote URLs by downloading first
        if fileUrl.hasPrefix("http://") || fileUrl.hasPrefix("https://") {
            downloadFile(urlString: fileUrl, mimeType: mimeType)
        } else if fileUrl.hasPrefix("file://") {
            // Handle local file URLs (for future implementation)
            delegate?.sendJSONCallback(eventName: "ON_INTENT_SUCCESS", data: [
                "message": "Local file URLs not yet implemented",
                "fileUrl": fileUrl,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "platform": "ios"
            ])
        }
    }

    // MARK: - Private Methods

    // Download remote file for intent operations
    private func downloadFile(urlString: String, mimeType: String?) {
        guard let url = URL(string: urlString) else {
            fileLogger.error("Invalid URL: \(urlString)")
            delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Invalid URL", code: "INVALID_URL")
            return
        }

        fileLogger.debug("Starting download from: \(urlString)")

        // Create a download task
        let session = URLSession.shared
        downloadTask = session.downloadTask(with: url) { [weak self] localURL, response, error in
            guard let self = self else { return }

            if let error = error {
                if (error as NSError).code == NSURLErrorCancelled {
                    fileLogger.debug("Download cancelled by user")
                    self.delegate?.sendCallback(eventName: "ON_INTENT_CANCELLED", data: "Download cancelled")
                    return
                }
                fileLogger.error("Download failed: \(error.localizedDescription)")
                self.delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Download failed: \(error.localizedDescription)", code: "DOWNLOAD_ERROR")
                return
            }

            guard let localURL = localURL else {
                fileLogger.error("Download completed but no local file URL")
                self.delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Download completed but no local file URL", code: "DOWNLOAD_ERROR")
                return
            }

            // Check file size (100MB limit like Android)
            do {
                let fileSize = try FileManager.default.attributesOfItem(atPath: localURL.path)[.size] as? Int64 ?? 0
                let maxSizeBytes: Int64 = CatalystConstants.FileTransport.frameworkServerSizeLimit

                if fileSize > maxSizeBytes {
                    fileLogger.error("File too large: \(fileSize) bytes (max: \(maxSizeBytes) bytes)")
                    self.delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "File too large (max: 100MB)", code: "FILE_TOO_LARGE")
                    return
                }
            } catch {
                fileLogger.error("Error checking file size: \(error.localizedDescription)")
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

                fileLogger.debug("File downloaded successfully to: \(destinationURL.path)")

                // Open the downloaded file with external app
                DispatchQueue.main.async {
                    self.openFileWithExternalApp(fileURL: destinationURL, mimeType: mimeType)
                }

            } catch {
                fileLogger.error("Failed to move downloaded file: \(error.localizedDescription)")
                self.delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Failed to process downloaded file", code: "FILE_PROCESSING_ERROR")
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
        fileLogger.debug("Opening file with external app: \(fileURL.lastPathComponent)")

        // Find a valid UIViewController using helper method
        guard let viewController = findTopViewController() else {
            fileLogger.error("No valid view controller available")
            delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "No valid view controller available", code: "VIEW_CONTROLLER_ERROR")
            return
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            fileLogger.error("File does not exist: \(fileURL.path)")
            delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "File does not exist", code: "FILE_NOT_FOUND")
            return
        }

        // Create document interaction controller
        documentInteractionController = UIDocumentInteractionController(url: fileURL)
        documentInteractionController?.delegate = self

        // Try to present open-in menu
        let presented = documentInteractionController?.presentOpenInMenu(from: viewController.view.bounds, in: viewController.view, animated: true) ?? false

        if !presented {
            fileLogger.info("No apps available for open-in menu, trying sharing sheet")
            presentSharingSheet(for: fileURL)
        } else {
            fileLogger.debug("Open-in menu presented successfully")
        }
    }

    // Present sharing sheet as fallback
    private func presentSharingSheet(for fileURL: URL) {
        // Find a valid UIViewController using helper method
        guard let viewController = findTopViewController() else {
            fileLogger.error("No valid view controller available for sharing sheet")
            delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Unable to present sharing options", code: "VIEW_CONTROLLER_ERROR")
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
                fileLogger.error("Sharing failed: \(error.localizedDescription)")
                self?.delegate?.sendErrorCallback(eventName: "ON_INTENT_ERROR", error: "Sharing failed: \(error.localizedDescription)", code: "SHARING_ERROR")
            } else if completed {
                fileLogger.debug("File shared/opened successfully")
                self?.delegate?.sendJSONCallback(eventName: "ON_INTENT_SUCCESS", data: [
                    "message": "File opened successfully",
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                    "platform": "ios"
                ])
            } else {
                fileLogger.debug("Sharing cancelled by user")
                self?.delegate?.sendJSONCallback(eventName: "ON_INTENT_CANCELLED", data: [
                    "message": "File opening cancelled",
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                    "platform": "ios"
                ])
            }
        }

        viewController.present(shareController, animated: true)
    }

    // MARK: - Configuration

    // Update view controller reference if needed
    func updateViewController(_ newViewController: UIViewController) {
        self.viewController = newViewController
        fileLogger.debug("View controller reference updated in file handler")
    }
}

// MARK: - UIDocumentInteractionControllerDelegate

extension BridgeFileHandler: UIDocumentInteractionControllerDelegate {

    func documentInteractionControllerViewControllerForPreview(_ controller: UIDocumentInteractionController) -> UIViewController {
        return findTopViewController() ?? UIViewController()
    }

    func documentInteractionControllerDidEndPreview(_ controller: UIDocumentInteractionController) {
        fileLogger.debug("Document preview ended")
        delegate?.sendJSONCallback(eventName: "ON_INTENT_SUCCESS", data: [
            "message": "File preview completed",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "platform": "ios"
        ])
    }

    func documentInteractionController(_ controller: UIDocumentInteractionController, didEndSendingToApplication application: String?) {
        if let app = application {
            fileLogger.debug("File sent to application: \(app)")
            delegate?.sendJSONCallback(eventName: "ON_INTENT_SUCCESS", data: [
                "message": "File opened with \(app)",
                "application": app,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "platform": "ios"
            ])
        } else {
            fileLogger.debug("File sharing completed")
            delegate?.sendJSONCallback(eventName: "ON_INTENT_SUCCESS", data: [
                "message": "File shared successfully",
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "platform": "ios"
            ])
        }
    }
}