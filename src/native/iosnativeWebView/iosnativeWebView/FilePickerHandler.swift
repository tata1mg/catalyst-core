//
//  FilePickerHandler.swift
//  iosnativeWebView
//
//  Created for file picker functionality
//

import Foundation
import UIKit
import UniformTypeIdentifiers
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "FilePickerHandler")

protocol FilePickerHandlerDelegate: AnyObject {
    func filePickerHandler(_ handler: FilePickerHandler, didPickFileAt url: URL, withMetadata metadata: FileMetadata)
    func filePickerHandlerDidCancel(_ handler: FilePickerHandler)
    func filePickerHandler(_ handler: FilePickerHandler, didFailWithError error: Error)
    func filePickerHandler(_ handler: FilePickerHandler, stateDidChange state: String)
}

struct FileMetadata {
    let fileName: String
    let fileSize: Int64
    let mimeType: String
    let fileExtension: String
    let lastModified: Date?
}

enum FileTransportMethod {
    case base64
    case fileURL
    case frameworkServer

    var name: String {
        switch self {
        case .base64: return "BASE64"
        case .fileURL: return "FILE_URL"
        case .frameworkServer: return "FRAMEWORK_SERVER"
        }
    }
}

struct FileProcessingResult {
    let success: Bool
    let fileSrc: String?
    let fileName: String
    let fileSize: Int64
    let mimeType: String
    let transport: FileTransportMethod
    let error: String?
}

class FilePickerHandler: NSObject {
    weak var delegate: FilePickerHandlerDelegate?
    private var documentPicker: UIDocumentPickerViewController?

    // File size constants (matching Android implementation)
    private let BASE64_SIZE_LIMIT: Int64 = 5 * 1024 * 1024  // 5MB
    private let FILE_URL_SIZE_LIMIT: Int64 = 50 * 1024 * 1024  // 50MB
    private let MAX_FILE_SIZE: Int64 = 100 * 1024 * 1024  // 100MB

    override init() {
        super.init()
        logger.debug("FilePickerHandler initialized")
    }

    // MARK: - Public Methods

    func presentFilePicker(from viewController: UIViewController, mimeType: String = "*/*") {
        logger.debug("Presenting file picker with MIME type: \(mimeType)")

        delegate?.filePickerHandler(self, stateDidChange: "opening")

        // Convert MIME type to UTType
        let allowedTypes = convertMimeTypeToUTTypes(mimeType)
        logger.debug("Converted to UTTypes: \(allowedTypes.map { $0.identifier })")

        // Check if we have valid UTTypes
        if allowedTypes.isEmpty {
            let error = NSError(domain: "FilePickerError", code: -5, userInfo: [NSLocalizedDescriptionKey: "Unsupported MIME type: \(mimeType)"])
            delegate?.filePickerHandler(self, didFailWithError: error)
            return
        }

        documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: allowedTypes)
        documentPicker?.delegate = self
        documentPicker?.allowsMultipleSelection = false
        documentPicker?.modalPresentationStyle = .formSheet

        // Log the actual UTTypes being used for debugging
        logger.debug("Document picker created with \(allowedTypes.count) UTTypes")
        for (index, utType) in allowedTypes.enumerated() {
            logger.debug("UTType \(index): \(utType.identifier) - \(utType.description)")
        }

        if let picker = documentPicker {
            viewController.present(picker, animated: true) { [weak self] in
                self?.delegate?.filePickerHandler(self!, stateDidChange: "opened")
            }
        } else {
            let error = NSError(domain: "FilePickerError", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create document picker"])
            delegate?.filePickerHandler(self, didFailWithError: error)
        }
    }

    // MARK: - Private Methods

    private func convertMimeTypeToUTTypes(_ mimeType: String) -> [UTType] {
        logger.debug("Converting MIME type: \(mimeType)")

        // Handle comma-separated MIME types (e.g., "application/pdf,image/*")
        if mimeType.contains(",") {
            logger.debug("Processing comma-separated MIME types: \(mimeType)")
            let mimeTypes = mimeType.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            var allUTTypes: [UTType] = []

            for individualMimeType in mimeTypes {
                let utTypes = convertMimeTypeToUTTypes(individualMimeType)
                allUTTypes.append(contentsOf: utTypes)
            }

            // Remove duplicates using Set and return
            let uniqueUTTypes = Array(Set(allUTTypes.map { $0.identifier })).compactMap { UTType($0) }
            logger.debug("Combined UTTypes from multiple MIME types: \(uniqueUTTypes.map { $0.identifier })")
            return uniqueUTTypes
        }

        // Handle wildcards FIRST (before iOS native handling to ensure proper filtering)
        if mimeType.contains("*") {
            logger.debug("Processing wildcard MIME type: \(mimeType)")
            return handleWildcardMimeType(mimeType)
        }

        // Use iOS native MIME type handling only for specific (non-wildcard) MIME types
        if let nativeUTType = UTType(mimeType: mimeType) {
            logger.debug("iOS natively handled specific MIME type: \(mimeType) -> \(nativeUTType.identifier)")
            return [nativeUTType]
        }

        // Fallback for unknown specific MIME types
        logger.warning("Unknown specific MIME type: \(mimeType)")
        return []
    }

    private func handleWildcardMimeType(_ mimeType: String) -> [UTType] {
        switch mimeType.lowercased() {
        case "*/*":
            logger.debug("Allowing all file types")
            return [UTType.data] // Allow all files

        case "image/*":
            logger.debug("Restricting to common image formats only")
            // Only common image formats to prevent unwanted files like PDFs
            return [UTType.jpeg, UTType.png, UTType.gif, UTType.webP, UTType.heic]

        case "video/*":
            logger.debug("Restricting to common video formats")
            // Common video formats
            return [UTType.mpeg4Movie, UTType.quickTimeMovie, UTType.avi, UTType.movie]

        case "audio/*":
            logger.debug("Restricting to common audio formats")
            // Common audio formats
            return [UTType.mp3, UTType.wav, UTType.aiff, UTType.audio]

        case "text/*":
            logger.debug("Restricting to common text formats")
            // Common text formats
            return [UTType.plainText, UTType.utf8PlainText, UTType.html]

        case "application/*":
            logger.debug("Restricting to common application formats")
            // Common application formats
            return [UTType.pdf, UTType.json, UTType.zip, UTType.executable]

        default:
            // Unknown wildcard pattern - be restrictive
            logger.warning("Unknown wildcard MIME type pattern: \(mimeType)")
            return []
        }
    }

    private func extractFileMetadata(from url: URL) -> FileMetadata {
        let fileName = url.lastPathComponent
        let fileExtension = url.pathExtension

        // Get file size
        var fileSize: Int64 = 0
        if let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
           let size = attributes[.size] as? Int64 {
            fileSize = size
        }

        // Get MIME type
        let mimeType = getMimeType(for: url)

        // Get last modified date
        var lastModified: Date?
        if let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
           let date = attributes[.modificationDate] as? Date {
            lastModified = date
        }

        return FileMetadata(
            fileName: fileName,
            fileSize: fileSize,
            mimeType: mimeType,
            fileExtension: fileExtension,
            lastModified: lastModified
        )
    }

    private func getMimeType(for url: URL) -> String {
        // First try UTType
        if let utType = UTType(filenameExtension: url.pathExtension) {
            return utType.preferredMIMEType ?? "*/*"
        }

        // Fallback based on file extension
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "pdf": return "application/pdf"
        case "txt": return "text/plain"
        case "json": return "application/json"
        case "zip": return "application/zip"
        case "mp4": return "video/mp4"
        case "mp3": return "audio/mpeg"
        case "csv": return "text/csv"
        default: return "*/*"
        }
    }

    private func determineTransportMethod(fileSize: Int64) -> FileTransportMethod {
        if fileSize <= BASE64_SIZE_LIMIT {
            return .base64
        } else if fileSize <= FILE_URL_SIZE_LIMIT {
            return .fileURL
        } else {
            return .frameworkServer
        }
    }

    func processFile(at url: URL, metadata: FileMetadata) -> FileProcessingResult {
        logger.debug("Processing file: \(metadata.fileName) (\(self.formatFileSize(metadata.fileSize)))")

        // Check file size limits
        if metadata.fileSize > MAX_FILE_SIZE {
            return FileProcessingResult(
                success: false,
                fileSrc: nil,
                fileName: metadata.fileName,
                fileSize: metadata.fileSize,
                mimeType: metadata.mimeType,
                transport: .base64,
                error: "File too large. Maximum size: \(self.formatFileSize(MAX_FILE_SIZE))"
            )
        }

        let transport = determineTransportMethod(fileSize: metadata.fileSize)
        logger.debug("Using transport method: \(transport.name)")

        switch transport {
        case .base64:
            return processFileAsBase64(url: url, metadata: metadata)
        case .fileURL:
            return processFileAsURL(url: url, metadata: metadata)
        case .frameworkServer:
            // For now, fallback to file URL (framework server not implemented yet)
            return processFileAsURL(url: url, metadata: metadata)
        }
    }

    private func processFileAsBase64(url: URL, metadata: FileMetadata) -> FileProcessingResult {
        do {
            let data = try Data(contentsOf: url)
            let base64String = data.base64EncodedString()
            let dataURL = "data:\(metadata.mimeType);base64,\(base64String)"

            logger.debug("File converted to base64 successfully")

            return FileProcessingResult(
                success: true,
                fileSrc: dataURL,
                fileName: metadata.fileName,
                fileSize: metadata.fileSize,
                mimeType: metadata.mimeType,
                transport: .base64,
                error: nil
            )
        } catch {
            logger.error("Failed to convert file to base64: \(error.localizedDescription)")
            return FileProcessingResult(
                success: false,
                fileSrc: nil,
                fileName: metadata.fileName,
                fileSize: metadata.fileSize,
                mimeType: metadata.mimeType,
                transport: .base64,
                error: "Failed to read file: \(error.localizedDescription)"
            )
        }
    }

    private func processFileAsURL(url: URL, metadata: FileMetadata) -> FileProcessingResult {
        do {
            // Copy file to app's documents directory to ensure access
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let fileName = "\(UUID().uuidString)_\(metadata.fileName)"
            let destinationURL = documentsPath.appendingPathComponent(fileName)

            // Remove existing file if it exists
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }

            try FileManager.default.copyItem(at: url, to: destinationURL)

            logger.debug("File copied to accessible location: \(destinationURL.path)")

            // Use secure relative path instead of absolute file:// URL to prevent path exposure
            let secureFilePath = "catalyst-files/\(fileName)"

            return FileProcessingResult(
                success: true,
                fileSrc: secureFilePath,
                fileName: metadata.fileName,
                fileSize: metadata.fileSize,
                mimeType: metadata.mimeType,
                transport: .fileURL,
                error: nil
            )
        } catch {
            logger.error("Failed to copy file: \(error.localizedDescription)")
            return FileProcessingResult(
                success: false,
                fileSrc: nil,
                fileName: metadata.fileName,
                fileSize: metadata.fileSize,
                mimeType: metadata.mimeType,
                transport: .fileURL,
                error: "Failed to copy file: \(error.localizedDescription)"
            )
        }
    }

    private func formatFileSize(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}

// MARK: - UIDocumentPickerDelegate

extension FilePickerHandler: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        logger.debug("Document picker did pick documents: \(urls.count)")

        guard let url = urls.first else {
            let error = NSError(domain: "FilePickerError", code: -2, userInfo: [NSLocalizedDescriptionKey: "No file selected"])
            delegate?.filePickerHandler(self, didFailWithError: error)
            return
        }

        delegate?.filePickerHandler(self, stateDidChange: "processing")

        // Start accessing security-scoped resource
        let accessing = url.startAccessingSecurityScopedResource()
        defer {
            if accessing {
                url.stopAccessingSecurityScopedResource()
            }
        }

        // Extract metadata
        let metadata = extractFileMetadata(from: url)
        logger.debug("File metadata: \(metadata.fileName), \(self.formatFileSize(metadata.fileSize)), \(metadata.mimeType)")

        // Additional debugging for PDF issue
        logger.debug("File extension: \(metadata.fileExtension)")
        logger.debug("File path: \(url.path)")
        logger.debug("Is PDF file being processed despite image/* filter!")

        // Process the file
        let result = processFile(at: url, metadata: metadata)

        if result.success {
            // Create a temporary URL for the delegate
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let tempFileName = "\(UUID().uuidString)_\(metadata.fileName)"
            let tempURL = documentsPath.appendingPathComponent(tempFileName)

            // Copy file for delegate access
            do {
                if FileManager.default.fileExists(atPath: tempURL.path) {
                    try FileManager.default.removeItem(at: tempURL)
                }
                try FileManager.default.copyItem(at: url, to: tempURL)

                delegate?.filePickerHandler(self, didPickFileAt: tempURL, withMetadata: metadata)
            } catch {
                let nsError = NSError(domain: "FilePickerError", code: -3, userInfo: [NSLocalizedDescriptionKey: "Failed to process file: \(error.localizedDescription)"])
                delegate?.filePickerHandler(self, didFailWithError: nsError)
            }
        } else {
            let nsError = NSError(domain: "FilePickerError", code: -4, userInfo: [NSLocalizedDescriptionKey: result.error ?? "Unknown processing error"])
            delegate?.filePickerHandler(self, didFailWithError: nsError)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        logger.debug("Document picker was cancelled")
        delegate?.filePickerHandlerDidCancel(self)
    }
}