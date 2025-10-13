//
//  FilePickerHandler.swift
//  iosnativeWebView
//
//  Created for file picker functionality
//

import Foundation
import UIKit
import UniformTypeIdentifiers
import PhotosUI
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
    case frameworkServer

    var name: String {
        switch self {
        case .base64: return "BRIDGE_BASE64"
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
    private var photoPicker: PHPickerViewController?

    // File size constants from unified configuration
    private let BASE64_SIZE_LIMIT: Int64 = CatalystConstants.FileTransport.base64SizeLimit
    private let FRAMEWORK_SERVER_SIZE_LIMIT: Int64 = CatalystConstants.FileTransport.frameworkServerSizeLimit

    override init() {
        super.init()
        logger.debug("FilePickerHandler initialized")
    }

    // MARK: - Public Methods

    func presentFilePicker(from viewController: UIViewController, mimeType: String = "*/*") {
        logger.debug("Presenting file picker with MIME type: \(mimeType)")

        delegate?.filePickerHandler(self, stateDidChange: "opening")

        // For image selection, use PHPickerViewController for better photo library access
        // Only use photo picker for image-specific requests or when explicitly asking for media
        if (mimeType.lowercased() == "image/*" || mimeType.lowercased() == "*/*") {
            if #available(iOS 14.0, *) {
                presentPhotoPicker(from: viewController, mimeType: mimeType)
                return
            }
        }

        // Use document picker for other file types
        presentDocumentPicker(from: viewController, mimeType: mimeType)
    }

    @available(iOS 14.0, *)
    private func presentPhotoPicker(from viewController: UIViewController, mimeType: String) {
        logger.debug("Using PHPickerViewController for image selection")

        var config = PHPickerConfiguration()
        config.selectionLimit = 1

        // Configure for images only if specifically requested
        if mimeType.lowercased() == "image/*" {
            config.filter = .images
        } else {
            // For *.* allow images and videos
            config.filter = .any(of: [.images, .videos])
        }

        photoPicker = PHPickerViewController(configuration: config)
        photoPicker?.delegate = self

        viewController.present(photoPicker!, animated: true) { [weak self] in
            guard let strongSelf = self else {
                logger.error("FilePickerHandler deallocated during photo picker presentation")
                return
            }
            strongSelf.delegate?.filePickerHandler(strongSelf, stateDidChange: "opened")
        }
    }

    private func presentDocumentPicker(from viewController: UIViewController, mimeType: String) {
        logger.debug("Using UIDocumentPickerViewController for file selection")

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

        // Enable access to all locations including Photos
        if #available(iOS 14.0, *) {
            documentPicker?.shouldShowFileExtensions = true
        }

        // Log the actual UTTypes being used for debugging
        logger.debug("Document picker created with \(allowedTypes.count) UTTypes for MIME: \(mimeType)")
        for (index, utType) in allowedTypes.enumerated() {
            logger.debug("UTType \(index): \(utType.identifier) - \(utType.description)")
            if let preferredMimeType = utType.preferredMIMEType {
                logger.debug("  Preferred MIME: \(preferredMimeType)")
            }
        }

        if let picker = documentPicker {
            viewController.present(picker, animated: true) { [weak self] in
                guard let strongSelf = self else {
                    logger.error("FilePickerHandler deallocated during document picker presentation")
                    return
                }
                strongSelf.delegate?.filePickerHandler(strongSelf, stateDidChange: "opened")
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
            logger.debug("Allowing all file types including photos")
            // Use UTType.item which includes all content types, including photos
            // Also explicitly add image types to ensure photo library access
            return [UTType.item, UTType.image, UTType.jpeg, UTType.png, UTType.heic]

        case "image/*":
            logger.debug("Restricting to common image formats only")
            // Common image formats with broader compatibility
            var imageTypes: [UTType] = [UTType.jpeg, UTType.png, UTType.gif, UTType.heic, UTType.image]

            // Add webP if available (iOS 14+)
            if #available(iOS 14.0, *), let webPType = UTType("public.webp") {
                imageTypes.append(webPType)
            }

            return imageTypes

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
        } else {
            return .frameworkServer
        }
    }

    func processFile(at url: URL, metadata: FileMetadata) -> FileProcessingResult {
        logger.debug("Processing file: \(metadata.fileName) (\(self.formatFileSize(metadata.fileSize)))")

        // Check file size limits
        if metadata.fileSize > FRAMEWORK_SERVER_SIZE_LIMIT {
            return FileProcessingResult(
                success: false,
                fileSrc: nil,
                fileName: metadata.fileName,
                fileSize: metadata.fileSize,
                mimeType: metadata.mimeType,
                transport: .base64,
                error: "File too large. Maximum size: \(self.formatFileSize(FRAMEWORK_SERVER_SIZE_LIMIT))"
            )
        }

        let transport = determineTransportMethod(fileSize: metadata.fileSize)
        logger.debug("Using transport method: \(transport.name)")

        switch transport {
        case .base64:
            return processFileAsBase64(url: url, metadata: metadata)
        case .frameworkServer:
            return processFileWithFrameworkServer(url: url, metadata: metadata)
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


    private func processFileWithFrameworkServer(url: URL, metadata: FileMetadata) -> FileProcessingResult {
        logger.info("Processing file with framework server transport")

        let frameworkServer = FrameworkServerUtils.shared

        // Ensure framework server is running
        if !frameworkServer.isRunning() {
            logger.info("Framework server not running, starting server...")
            if !frameworkServer.startServer() {
                logger.error("Failed to start framework server, falling back to local file URL")
                return fallbackToFileUrlProcessing(url: url, metadata: metadata)
            }
        }

        // Copy file to server cache and get serving URL
        guard let serverUrl = frameworkServer.copyAndServeFile(
            originalFile: url,
            fileName: metadata.fileName,
            mimeType: metadata.mimeType
        ) else {
            logger.error("Failed to add file to framework server, falling back to local file URL")
            return fallbackToFileUrlProcessing(url: url, metadata: metadata)
        }

        logger.debug("Successfully processed file with framework server: \(serverUrl)")

        return FileProcessingResult(
            success: true,
            fileSrc: serverUrl,
            fileName: metadata.fileName,
            fileSize: metadata.fileSize,
            mimeType: metadata.mimeType,
            transport: .frameworkServer,
            error: nil
        )
    }

    private func fallbackToFileUrlProcessing(url: URL, metadata: FileMetadata) -> FileProcessingResult {
        do {
            // Copy file to app's documents directory to ensure access (iOS equivalent of content provider)
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let fileName = "\(UUID().uuidString)_\(metadata.fileName)"
            let destinationURL = documentsPath.appendingPathComponent(fileName)

            // Remove existing file if it exists
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }

            try FileManager.default.copyItem(at: url, to: destinationURL)

            logger.debug("File copied to accessible location for fallback: \(destinationURL.path)")

            // Use secure relative path instead of absolute file:// URL
            let secureFilePath = "catalyst-files/\(fileName)"

            return FileProcessingResult(
                success: true,
                fileSrc: secureFilePath,
                fileName: metadata.fileName,
                fileSize: metadata.fileSize,
                mimeType: metadata.mimeType,
                transport: .frameworkServer, // Still report as framework server since it's the intended transport
                error: nil
            )
        } catch {
            logger.error("Fallback file URL processing failed: \(error.localizedDescription)")
            return FileProcessingResult(
                success: false,
                fileSrc: nil,
                fileName: metadata.fileName,
                fileSize: metadata.fileSize,
                mimeType: metadata.mimeType,
                transport: .frameworkServer,
                error: "Framework server and fallback both failed: \(error.localizedDescription)"
            )
        }
    }

    private func formatFileSize(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}

// MARK: - PHPickerViewControllerDelegate

@available(iOS 14.0, *)
extension FilePickerHandler: PHPickerViewControllerDelegate {
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard let result = results.first else {
            logger.debug("Photo picker was cancelled or no selection made")
            delegate?.filePickerHandlerDidCancel(self)
            return
        }

        delegate?.filePickerHandler(self, stateDidChange: "processing")

        // Get the item provider
        let itemProvider = result.itemProvider

        // Handle different content types
        if itemProvider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            // Handle images
            logger.debug("Processing selected image")
            loadItemData(itemProvider: itemProvider, typeIdentifier: UTType.image.identifier, result: result)
        } else if itemProvider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            // Handle videos
            logger.debug("Processing selected video")
            loadItemData(itemProvider: itemProvider, typeIdentifier: UTType.movie.identifier, result: result)
        } else if itemProvider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
            // Handle other data types
            logger.debug("Processing selected data file")
            loadItemData(itemProvider: itemProvider, typeIdentifier: UTType.data.identifier, result: result)
        } else {
            // Try to get any available type
            if let availableType = itemProvider.registeredTypeIdentifiers.first {
                logger.debug("Processing selected file with type: \(availableType)")
                loadItemData(itemProvider: itemProvider, typeIdentifier: availableType, result: result)
            } else {
                logger.error("Selected item has no supported type identifiers")
                let nsError = NSError(domain: "FilePickerError", code: -8, userInfo: [NSLocalizedDescriptionKey: "Selected item type not supported"])
                self.delegate?.filePickerHandler(self, didFailWithError: nsError)
            }
        }
    }

    private func loadItemData(itemProvider: NSItemProvider, typeIdentifier: String, result: PHPickerResult) {
        itemProvider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { [weak self] (data, error) in
            DispatchQueue.main.async {
                guard let self = self else { return }

                if let error = error {
                    logger.error("Failed to load item data: \(error.localizedDescription)")
                    let nsError = NSError(domain: "FilePickerError", code: -6, userInfo: [NSLocalizedDescriptionKey: "Failed to load file: \(error.localizedDescription)"])
                    self.delegate?.filePickerHandler(self, didFailWithError: nsError)
                    return
                }

                guard let itemData = data else {
                    let nsError = NSError(domain: "FilePickerError", code: -7, userInfo: [NSLocalizedDescriptionKey: "No file data received"])
                    self.delegate?.filePickerHandler(self, didFailWithError: nsError)
                    return
                }

                // Create a temporary file
                self.savePhotoPickerResult(data: itemData, result: result, typeIdentifier: typeIdentifier)
            }
        }
    }

    private func savePhotoPickerResult(data: Data, result: PHPickerResult, typeIdentifier: String) {
        do {
            // Create a temporary file name
            let fileExtension = getFileExtension(from: result, typeIdentifier: typeIdentifier)
            let fileName = "\(UUID().uuidString).\(fileExtension)"

            // Save to documents directory
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let fileURL = documentsPath.appendingPathComponent(fileName)

            try data.write(to: fileURL)

            // Create metadata
            let metadata = FileMetadata(
                fileName: fileName,
                fileSize: Int64(data.count),
                mimeType: getMimeTypeFromTypeIdentifier(typeIdentifier) ?? getMimeType(for: fileURL),
                fileExtension: fileExtension,
                lastModified: Date()
            )

            logger.debug("Photo picker result saved: \(fileName), type: \(typeIdentifier), size: \(self.formatFileSize(metadata.fileSize))")

            delegate?.filePickerHandler(self, didPickFileAt: fileURL, withMetadata: metadata)

        } catch {
            logger.error("Failed to save photo picker result: \(error.localizedDescription)")
            let nsError = NSError(domain: "FilePickerError", code: -9, userInfo: [NSLocalizedDescriptionKey: "Failed to save file: \(error.localizedDescription)"])
            delegate?.filePickerHandler(self, didFailWithError: nsError)
        }
    }

    private func getFileExtension(from result: PHPickerResult, typeIdentifier: String) -> String {
        // Try to get the file extension from the suggested name first
        if let suggestedName = result.itemProvider.suggestedName,
           !URL(fileURLWithPath: suggestedName).pathExtension.isEmpty {
            return URL(fileURLWithPath: suggestedName).pathExtension
        }

        // Fallback based on type identifier
        if let utType = UTType(typeIdentifier) {
            if let preferredExtension = utType.preferredFilenameExtension {
                return preferredExtension
            }
        }

        // Final fallback based on common type identifiers
        switch typeIdentifier {
        case UTType.jpeg.identifier, "public.jpeg":
            return "jpg"
        case UTType.png.identifier, "public.png":
            return "png"
        case UTType.heic.identifier, "public.heic":
            return "heic"
        case UTType.gif.identifier, "public.gif":
            return "gif"
        case UTType.mpeg4Movie.identifier, "public.mpeg-4":
            return "mp4"
        case UTType.quickTimeMovie.identifier, "com.apple.quicktime-movie":
            return "mov"
        default:
            return "dat" // Generic data file
        }
    }

    private func getMimeTypeFromTypeIdentifier(_ typeIdentifier: String) -> String? {
        if let utType = UTType(typeIdentifier) {
            return utType.preferredMIMEType
        }
        return nil
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