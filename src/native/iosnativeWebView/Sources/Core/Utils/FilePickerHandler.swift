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

struct FilePickerOptions: CustomStringConvertible {
    let mimeType: String
    let multiple: Bool
    let minFiles: Int?
    let maxFiles: Int?
    let minFileSize: Int64?
    let maxFileSize: Int64?

    static let `default` = FilePickerOptions(
        mimeType: "*/*",
        multiple: false,
        minFiles: nil,
        maxFiles: nil,
        minFileSize: nil,
        maxFileSize: nil
    )

    static func from(raw: String?) -> FilePickerOptions {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return .default
        }

        guard raw.hasPrefix("{"), raw.hasSuffix("}"),
              let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return FilePickerOptions(
                mimeType: raw,
                multiple: false,
                minFiles: nil,
                maxFiles: nil,
                minFileSize: nil,
                maxFileSize: nil
            )
        }

        let mimeType = (json["mimeType"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "*/*"
        let explicitMultiple = json["multiple"] as? Bool ?? false
        let minFiles = parseInt(json["minFiles"])
        let maxFiles = parseInt(json["maxFiles"])
        let minFileSize = parseInt64(json["minFileSize"])
        let maxFileSize = parseInt64(json["maxFileSize"])

        let inferredMultiple = explicitMultiple || (minFiles ?? 0) > 1 || (maxFiles ?? 0) > 1

        return FilePickerOptions(
            mimeType: mimeType.isEmpty ? "*/*" : mimeType,
            multiple: inferredMultiple,
            minFiles: minFiles,
            maxFiles: maxFiles,
            minFileSize: minFileSize,
            maxFileSize: maxFileSize
        )
    }

    var selectionLimit: Int {
        guard multiple else { return 1 }
        if let maxFiles, maxFiles > 0 { return maxFiles }
        return 0 // Unlimited
    }

    func toDictionary() -> [String: Any] {
        var dict: [String: Any] = [
            "mimeType": mimeType,
            "multiple": multiple
        ]
        if let minFiles { dict["minFiles"] = minFiles }
        if let maxFiles { dict["maxFiles"] = maxFiles }
        if let minFileSize { dict["minFileSize"] = minFileSize }
        if let maxFileSize { dict["maxFileSize"] = maxFileSize }
        return dict
    }

    var description: String {
        return toDictionary().map { "\($0.key)=\($0.value)" }.sorted().joined(separator: ", ")
    }

    private static func parseInt(_ value: Any?) -> Int? {
        switch value {
        case let intValue as Int: return intValue
        case let number as NSNumber: return number.intValue
        case let doubleValue as Double: return Int(doubleValue)
        case let stringValue as String: return Int(stringValue)
        default: return nil
        }
    }

    private static func parseInt64(_ value: Any?) -> Int64? {
        switch value {
        case let intValue as Int: return Int64(intValue)
        case let int64Value as Int64: return int64Value
        case let number as NSNumber: return number.int64Value
        case let doubleValue as Double: return Int64(doubleValue)
        case let stringValue as String: return Int64(stringValue)
        default: return nil
        }
    }
}

private struct PickedFile {
    let index: Int
    let url: URL
    let metadata: FileMetadata
}

protocol FilePickerHandlerDelegate: AnyObject {
    func filePickerHandler(_ handler: FilePickerHandler, didFinishWith payload: [String: Any])
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
    private var currentOptions: FilePickerOptions = .default
    private var temporaryFiles: [URL] = []

    // File size constants from unified configuration
    private let BASE64_SIZE_LIMIT: Int64 = CatalystConstants.FileTransport.base64SizeLimit
    private let FRAMEWORK_SERVER_SIZE_LIMIT: Int64 = CatalystConstants.FileTransport.frameworkServerSizeLimit

    override init() {
        super.init()
        logger.debug("FilePickerHandler initialized")
    }

    // MARK: - Public Methods

    func presentFilePicker(from viewController: UIViewController, options: FilePickerOptions = .default) {
        currentOptions = options
        cleanupTemporaryFiles()
        logger.debug("Presenting file picker with options: \(options)")

        delegate?.filePickerHandler(self, stateDidChange: "opening")

        // Use photo picker if all MIME types are images/videos, else use document picker
        let mimeTypes = options.mimeType.lowercased().split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        let allMedia = mimeTypes.allSatisfy { $0.hasPrefix("image/") || $0.hasPrefix("video/") }
        
        if allMedia, #available(iOS 14.0, *) {
            presentPhotoPicker(from: viewController, options: options)
        } else {
            presentDocumentPicker(from: viewController, options: options)
        }
    }

    @available(iOS 14.0, *)
    private func presentPhotoPicker(from viewController: UIViewController, options: FilePickerOptions) {
        logger.debug("Using PHPickerViewController for image/video selection")

        let mimeTypes = options.mimeType.lowercased().split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        let hasImages = mimeTypes.contains { $0.hasPrefix("image/") }
        let hasVideos = mimeTypes.contains { $0.hasPrefix("video/") }
        
        var config = PHPickerConfiguration()
        config.selectionLimit = options.selectionLimit
        config.filter = (hasImages && hasVideos) ? .any(of: [.images, .videos]) : hasVideos ? .videos : .images

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

    private func presentDocumentPicker(from viewController: UIViewController, options: FilePickerOptions) {
        logger.debug("Using UIDocumentPickerViewController for file selection")

        // Convert MIME type to UTType
        let allowedTypes = convertMimeTypeToUTTypes(options.mimeType)
        logger.debug("Converted to UTTypes: \(allowedTypes.map { $0.identifier })")

        // Check if we have valid UTTypes
        if allowedTypes.isEmpty {
            let error = NSError(domain: "FilePickerError", code: -5, userInfo: [NSLocalizedDescriptionKey: "Unsupported MIME type: \(options.mimeType)"])
            delegate?.filePickerHandler(self, didFailWithError: error)
            return
        }

        documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: allowedTypes)
        documentPicker?.delegate = self
        documentPicker?.allowsMultipleSelection = options.multiple
        documentPicker?.modalPresentationStyle = .formSheet

        // Enable access to all locations including Photos
        if #available(iOS 14.0, *) {
            documentPicker?.shouldShowFileExtensions = true
        }

        // Log the actual UTTypes being used for debugging
        logger.debug("Document picker created with \(allowedTypes.count) UTTypes for MIME: \(options.mimeType)")
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
        // First try UTType - only return if it has a preferredMIMEType
        if let utType = UTType(filenameExtension: url.pathExtension),
           let mimeType = utType.preferredMIMEType {
            return mimeType
        }

        // Fallback based on file extension with comprehensive mapping
        let ext = url.pathExtension.lowercased()
        
        switch ext {
        // Images
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        case "bmp": return "image/bmp"
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        case "ico": return "image/x-icon"
        case "tiff", "tif": return "image/tiff"
        
        // Documents
        case "pdf": return "application/pdf"
        case "doc": return "application/msword"
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "xls": return "application/vnd.ms-excel"
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        case "ppt": return "application/vnd.ms-powerpoint"
        case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        
        // Text
        case "txt": return "text/plain"
        case "html", "htm": return "text/html"
        case "css": return "text/css"
        case "csv": return "text/csv"
        
        // Data
        case "json": return "application/json"
        case "xml": return "application/xml"
        case "js": return "application/javascript"
        
        // Archives
        case "zip": return "application/zip"
        case "rar": return "application/x-rar-compressed"
        case "7z": return "application/x-7z-compressed"
        case "tar": return "application/x-tar"
        case "gz": return "application/gzip"
        
        // Video
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "avi": return "video/x-msvideo"
        case "webm": return "video/webm"
        case "mkv": return "video/x-matroska"
        case "m4v": return "video/x-m4v"
        case "flv": return "video/x-flv"
        
        // Audio
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "ogg": return "audio/ogg"
        case "m4a": return "audio/mp4"
        case "aac": return "audio/aac"
        case "flac": return "audio/flac"
        case "wma": return "audio/x-ms-wma"
        
        default:
            logger.warning("Unknown file extension '\(ext)', using application/octet-stream")
            return "application/octet-stream"
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

    private func cleanupTemporaryFiles() {
        guard !temporaryFiles.isEmpty else { return }
        let fileManager = FileManager.default
        for url in temporaryFiles {
            do {
                try fileManager.removeItem(at: url)
                logger.debug("Removed temporary file: \(url.lastPathComponent)")
            } catch {
                logger.warning("Failed to remove temporary file \(url.lastPathComponent): \(error.localizedDescription)")
            }
        }
        temporaryFiles.removeAll()
    }

    private func sanitizeSelectionForSingleSelect<T>(_ items: [T]) -> [T] {
        guard !currentOptions.multiple, items.count > 1 else {
            return items
        }

        logger.warning("Multiple selections received but picker configured for single file. Processing only the first item.")
        return Array(items.prefix(1))
    }

    private func selectionCountValidationMessage(_ count: Int) -> String? {
        if let minFiles = currentOptions.minFiles, count < minFiles {
            return "Select at least \(minFiles) file(s). You selected \(count)."
        }

        if let maxFiles = currentOptions.maxFiles, maxFiles > 0, count > maxFiles {
            return "You can select up to \(maxFiles) file(s). You selected \(count)."
        }

        return nil
    }

    private func sizeValidationMessage(for index: Int, size: Int64) -> String? {
        if let minSize = currentOptions.minFileSize, size < minSize {
            let actual = formatFileSize(size)
            let minimum = formatFileSize(minSize)
            return "File \(index + 1) is too small (\(actual)). Minimum size is \(minimum)."
        }

        if let maxSize = currentOptions.maxFileSize, size > maxSize {
            let actual = formatFileSize(size)
            let maximum = formatFileSize(maxSize)
            return "File \(index + 1) exceeds maximum size (\(actual) > \(maximum))."
        }

        return nil
    }

    private func makeError(code: Int, message: String) -> NSError {
        return NSError(domain: "FilePickerError", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func finalizeSelection(_ files: [PickedFile]) {
        defer { cleanupTemporaryFiles() }

        guard !files.isEmpty else {
            delegate?.filePickerHandler(self, didFailWithError: makeError(code: -2, message: "No file selected"))
            return
        }

        let orderedFiles = files.sorted { $0.index < $1.index }

        if let message = selectionCountValidationMessage(orderedFiles.count) {
            delegate?.filePickerHandler(self, didFailWithError: makeError(code: -10, message: message))
            return
        }

        delegate?.filePickerHandler(self, stateDidChange: "processing")

        for file in orderedFiles {
            if let message = sizeValidationMessage(for: file.index, size: file.metadata.fileSize) {
                delegate?.filePickerHandler(self, didFailWithError: makeError(code: -11, message: message))
                return
            }
        }

        delegate?.filePickerHandler(self, stateDidChange: "routing")

        var payloadFiles: [[String: Any]] = []
        var totalSize: Int64 = 0

        for file in orderedFiles {
            let result = processFile(at: file.url, metadata: file.metadata)
            guard result.success, let fileSrc = result.fileSrc else {
                let message = result.error ?? "Failed to process selected file."
                delegate?.filePickerHandler(self, didFailWithError: makeError(code: -12, message: message))
                return
            }

            let payload: [String: Any] = [
                "index": file.index,
                "fileName": result.fileName,
                "fileSrc": fileSrc,
                "size": result.fileSize,
                "mimeType": result.mimeType,
                "transport": result.transport.name,
                "source": "file_picker",
                "platform": "ios"
            ]

            payloadFiles.append(payload)
            totalSize += result.fileSize
        }

        var response: [String: Any] = [
            "multiple": payloadFiles.count > 1,
            "count": payloadFiles.count,
            "totalSize": totalSize,
            "files": payloadFiles,
            "options": currentOptions.toDictionary(),
            "source": "file_picker",
            "platform": "ios"
        ]

        if let first = payloadFiles.first {
            response["fileName"] = first["fileName"]
            response["fileSrc"] = first["fileSrc"]
            response["size"] = first["size"]
            response["mimeType"] = first["mimeType"]
            response["transport"] = first["transport"]
        }

        delegate?.filePickerHandler(self, stateDidChange: "complete")
        delegate?.filePickerHandler(self, didFinishWith: response)
    }
}

// MARK: - PHPickerViewControllerDelegate

@available(iOS 14.0, *)
extension FilePickerHandler: PHPickerViewControllerDelegate {
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard !results.isEmpty else {
            cleanupTemporaryFiles()
            logger.debug("Photo picker was cancelled or no selection made")
            delegate?.filePickerHandlerDidCancel(self)
            return
        }

        let sanitizedResults = sanitizeSelectionForSingleSelect(results)

        if let message = selectionCountValidationMessage(sanitizedResults.count) {
            cleanupTemporaryFiles()
            delegate?.filePickerHandler(self, didFailWithError: makeError(code: -10, message: message))
            return
        }

        processPhotoResults(sanitizedResults)
    }

    private func processPhotoResults(_ results: [PHPickerResult]) {
        var collected: [PickedFile] = []

        func handleResult(at index: Int) {
            if index >= results.count {
                finalizeSelection(collected)
                return
            }

            processPhotoResult(result: results[index], index: index) { outcome in
                switch outcome {
                case .success(let file):
                    collected.append(file)
                    handleResult(at: index + 1)
                case .failure(let error):
                    self.cleanupTemporaryFiles()
                    self.delegate?.filePickerHandler(self, didFailWithError: error)
                }
            }
        }

        handleResult(at: 0)
    }

    private func processPhotoResult(
        result: PHPickerResult,
        index: Int,
        completion: @escaping (Result<PickedFile, NSError>) -> Void
    ) {
        let itemProvider = result.itemProvider

        guard let typeIdentifier = preferredTypeIdentifier(for: itemProvider) else {
            logger.error("Selected item has no supported type identifiers")
            completion(.failure(makeError(code: -8, message: "Selected item type not supported")))
            return
        }

        logger.debug("Processing selected file with type: \(typeIdentifier)")

        loadItemData(
            itemProvider: itemProvider,
            typeIdentifier: typeIdentifier,
            result: result,
            index: index,
            completion: completion
        )
    }

    private func preferredTypeIdentifier(for itemProvider: NSItemProvider) -> String? {
        // Try to get the most specific type identifier first
        // Prefer specific types over generic ones
        let specificImageTypes = [
            UTType.heic.identifier,
            UTType.heif.identifier,
            UTType.jpeg.identifier,
            UTType.png.identifier,
            UTType.gif.identifier,
            "public.heic",
            "public.heif",
            "public.jpeg",
            "public.png",
            "public.gif"
        ]
        
        // Check if any specific image type is available
        for specificType in specificImageTypes {
            if itemProvider.hasItemConformingToTypeIdentifier(specificType) {
                return specificType
            }
        }
        
        // Check for specific video types
        let specificVideoTypes = [
            UTType.mpeg4Movie.identifier,
            UTType.quickTimeMovie.identifier,
            "public.mpeg-4",
            "com.apple.quicktime-movie"
        ]
        
        for specificType in specificVideoTypes {
            if itemProvider.hasItemConformingToTypeIdentifier(specificType) {
                return specificType
            }
        }
        
        // Fall back to generic types
        if itemProvider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            return UTType.image.identifier
        }

        if itemProvider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            return UTType.movie.identifier
        }

        if itemProvider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
            return UTType.data.identifier
        }

        return itemProvider.registeredTypeIdentifiers.first
    }

    private func loadItemData(
        itemProvider: NSItemProvider,
        typeIdentifier: String,
        result: PHPickerResult,
        index: Int,
        completion: @escaping (Result<PickedFile, NSError>) -> Void
    ) {
        itemProvider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { [weak self] data, error in
            DispatchQueue.main.async {
                guard let self = self else { return }

                if let error = error {
                    logger.error("Failed to load item data: \(error.localizedDescription)")
                    completion(.failure(self.makeError(code: -6, message: "Failed to load file: \(error.localizedDescription)")))
                    return
                }

                guard let data = data else {
                    completion(.failure(self.makeError(code: -7, message: "No file data received")))
                    return
                }

                do {
                    let pickedFile = try self.savePhotoPickerResult(
                        data: data,
                        result: result,
                        typeIdentifier: typeIdentifier,
                        index: index
                    )
                    completion(.success(pickedFile))
                } catch let nsError as NSError {
                    completion(.failure(nsError))
                } catch {
                    completion(.failure(self.makeError(code: -9, message: "Failed to save file: \(error.localizedDescription)")))
                }
            }
        }
    }

    private func savePhotoPickerResult(
        data: Data,
        result: PHPickerResult,
        typeIdentifier: String,
        index: Int
    ) throws -> PickedFile {
        let fileExtension = getFileExtension(from: result, typeIdentifier: typeIdentifier)
        let fileName = "\(UUID().uuidString).\(fileExtension)"
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let fileURL = documentsPath.appendingPathComponent(fileName)

        do {
            try data.write(to: fileURL)
        } catch {
            logger.error("Failed to save photo picker result: \(error.localizedDescription)")
            throw makeError(code: -9, message: "Failed to save file: \(error.localizedDescription)")
        }

        temporaryFiles.append(fileURL)

        // Get MIME type from typeIdentifier first, as file extension might be generic (.dat)
        let mimeTypeFromIdentifier = getMimeTypeFromTypeIdentifier(typeIdentifier)
        let finalMimeType = mimeTypeFromIdentifier ?? getMimeType(for: fileURL)

        let metadata = FileMetadata(
            fileName: fileName,
            fileSize: Int64(data.count),
            mimeType: finalMimeType,
            fileExtension: fileExtension,
            lastModified: Date()
        )

        logger.debug("Photo picker result saved: \(fileName), type: \(typeIdentifier), size: \(self.formatFileSize(metadata.fileSize))")

        return PickedFile(index: index, url: fileURL, metadata: metadata)
    }

    private func getFileExtension(from result: PHPickerResult, typeIdentifier: String) -> String {
        // Try to get the file extension from the suggested name first
        if let suggestedName = result.itemProvider.suggestedName,
           !URL(fileURLWithPath: suggestedName).pathExtension.isEmpty {
            let ext = URL(fileURLWithPath: suggestedName).pathExtension
            logger.debug("Using file extension '\(ext)' from suggested name: \(suggestedName)")
            return ext
        }

        // Fallback based on type identifier
        if let utType = UTType(typeIdentifier) {
            if let preferredExtension = utType.preferredFilenameExtension {
                logger.debug("Using file extension '\(preferredExtension)' from UTType for identifier: \(typeIdentifier)")
                return preferredExtension
            }
        }

        // Final fallback based on common type identifiers
        let fileExtension: String
        switch typeIdentifier {
        case UTType.jpeg.identifier, "public.jpeg":
            fileExtension = "jpg"
        case UTType.png.identifier, "public.png":
            fileExtension = "png"
        case UTType.heic.identifier, "public.heic":
            fileExtension = "heic"
        case UTType.gif.identifier, "public.gif":
            fileExtension = "gif"
        case UTType.mpeg4Movie.identifier, "public.mpeg-4":
            fileExtension = "mp4"
        case UTType.quickTimeMovie.identifier, "com.apple.quicktime-movie":
            fileExtension = "mov"
        default:
            fileExtension = "dat"
            logger.warning("Unknown type identifier '\(typeIdentifier)', defaulting to 'dat' extension")
        }
        
        logger.debug("Using file extension '\(fileExtension)' from type identifier fallback")
        return fileExtension
    }

    private func getMimeTypeFromTypeIdentifier(_ typeIdentifier: String) -> String? {
        guard let utType = UTType(typeIdentifier) else {
            return nil
        }
        
        // If UTType has a preferred MIME type, return it
        if let mimeType = utType.preferredMIMEType {
            return mimeType
        }
        
        // Handle generic types by checking if they conform to specific types
        if utType.conforms(to: .jpeg) {
            return "image/jpeg"
        } else if utType.conforms(to: .png) {
            return "image/png"
        } else if utType.conforms(to: .heic) {
            return "image/heic"
        } else if utType.conforms(to: .gif) {
            return "image/gif"
        } else if utType.conforms(to: .image) {
            return "image/jpeg"  // Default for generic images
        } else if utType.conforms(to: .movie) {
            return "video/mp4"  // Default for generic videos
        }
        
        return nil
    }
}

// MARK: - UIDocumentPickerDelegate

extension FilePickerHandler: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        logger.debug("Document picker did pick documents: \(urls.count)")

        if let message = selectionCountValidationMessage(urls.count) {
            delegate?.filePickerHandler(self, didFailWithError: makeError(code: -10, message: message))
            return
        }

        let sanitizedURLs = sanitizeSelectionForSingleSelect(urls)

        guard !sanitizedURLs.isEmpty else {
            delegate?.filePickerHandler(self, didFailWithError: makeError(code: -2, message: "No file selected"))
            return
        }

        var scopedURLs: [URL] = []
        var pickedFiles: [PickedFile] = []

        for (index, url) in sanitizedURLs.enumerated() {
            if url.startAccessingSecurityScopedResource() {
                scopedURLs.append(url)
            }

            let metadata = extractFileMetadata(from: url)
            logger.debug("File metadata: \(metadata.fileName), \(self.formatFileSize(metadata.fileSize)), \(metadata.mimeType)")

            pickedFiles.append(PickedFile(index: index, url: url, metadata: metadata))
        }

        defer {
            for url in scopedURLs {
                url.stopAccessingSecurityScopedResource()
            }
        }

        finalizeSelection(pickedFiles)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        logger.debug("Document picker was cancelled")
        delegate?.filePickerHandlerDidCancel(self)
    }
}
