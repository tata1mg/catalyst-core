//
//  CameraTransportUtils.swift
//  iosnativeWebView
//
//  Camera tri-transport architecture for iOS
//  Handles file size-based routing and processing similar to Android's FileSizeRouterUtils
//

import Foundation
import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "CameraTransportUtils")

// MARK: - Transport Types

enum TransportType: String, CaseIterable {
    case base64 = "BASE64"
    case fileUrl = "FILE_URL"
    case frameworkServer = "FRAMEWORK_SERVER"

    var name: String {
        return self.rawValue
    }
}

// MARK: - Transport Decision

struct TransportDecision {
    let transportType: TransportType
    let reason: String
    let fileSize: Int64
    let filePath: String
    let fileName: String
}

// MARK: - Processing Result

struct CameraProcessingResult {
    let success: Bool
    let fileName: String
    let fileSrc: String?
    let filePath: String?
    let fileSize: Int64
    let mimeType: String
    let transportUsed: TransportType
    let error: String?

    static func failure(error: String) -> CameraProcessingResult {
        return CameraProcessingResult(
            success: false,
            fileName: "",
            fileSrc: nil,
            filePath: nil,
            fileSize: 0,
            mimeType: "",
            transportUsed: .base64,
            error: error
        )
    }

    static func success(
        fileName: String,
        fileSrc: String?,
        filePath: String?,
        fileSize: Int64,
        mimeType: String,
        transportUsed: TransportType
    ) -> CameraProcessingResult {
        return CameraProcessingResult(
            success: true,
            fileName: fileName,
            fileSrc: fileSrc,
            filePath: filePath,
            fileSize: fileSize,
            mimeType: mimeType,
            transportUsed: transportUsed,
            error: nil
        )
    }
}

// MARK: - Camera Transport Router

class CameraTransportUtils {

    // Size thresholds from unified configuration
    static let BASE64_SIZE_LIMIT: Int64 = CatalystConstants.FileTransport.base64SizeLimit
    static let FRAMEWORK_SERVER_SIZE_LIMIT: Int64 = CatalystConstants.FileTransport.frameworkServerSizeLimit

    // MARK: - Transport Decision Logic

    /**
     * Determine the best transport method based on file size
     * Matches Android's FileSizeRouterUtils.determineTransport() logic
     */
    static func determineTransport(for fileURL: URL) -> TransportDecision {
        let fileName = fileURL.lastPathComponent
        let filePath = fileURL.path

        do {
            let fileAttributes = try FileManager.default.attributesOfItem(atPath: filePath)
            let fileSize = fileAttributes[.size] as? Int64 ?? 0

            logger.debug("Determining transport for file: \(fileName) (size: \(formatFileSize(fileSize)))")

            // Size-based routing logic exactly matching Android FileSizeRouterUtils
            if fileSize <= BASE64_SIZE_LIMIT {
                return TransportDecision(
                    transportType: .base64,
                    reason: "File size (\(formatFileSize(fileSize))) is within bridge base64 limit (\(formatFileSize(BASE64_SIZE_LIMIT)))",
                    fileSize: fileSize,
                    filePath: filePath,
                    fileName: fileName
                )
            } else if fileSize <= FRAMEWORK_SERVER_SIZE_LIMIT {
                return TransportDecision(
                    transportType: .frameworkServer,
                    reason: "File size (\(formatFileSize(fileSize))) exceeds bridge limit, using framework server (limit: \(formatFileSize(FRAMEWORK_SERVER_SIZE_LIMIT)))",
                    fileSize: fileSize,
                    filePath: filePath,
                    fileName: fileName
                )
            } else {
                // File too large - matches Android UNSUPPORTED behavior
                return TransportDecision(
                    transportType: .frameworkServer,
                    reason: "File size (\(formatFileSize(fileSize))) exceeds maximum supported size, will attempt framework server as fallback",
                    fileSize: fileSize,
                    filePath: filePath,
                    fileName: fileName
                )
            }

        } catch {
            logger.error("Error getting file attributes: \(error.localizedDescription)")
            // Fallback decision
            return TransportDecision(
                transportType: .base64,
                reason: "Error determining file size, defaulting to base64: \(error.localizedDescription)",
                fileSize: 0,
                filePath: filePath,
                fileName: fileName
            )
        }
    }

    // MARK: - File Processing

    /**
     * Process file using the determined transport method
     * Matches Android's FileSizeRouterUtils.processFile() functionality
     */
    static func processFile(decision: TransportDecision, options: [String: Any] = [:]) -> CameraProcessingResult {
        logger.info("Processing file with transport: \(decision.transportType.name) - \(decision.reason)")

        let fileURL = URL(fileURLWithPath: decision.filePath)
        let mimeType = getMimeType(for: fileURL)

        switch decision.transportType {
        case .base64:
            return processWithBase64(fileURL: fileURL, decision: decision, mimeType: mimeType, options: options)

        case .frameworkServer:
            return processWithFrameworkServer(fileURL: fileURL, decision: decision, mimeType: mimeType, options: options)

        case .fileUrl:
            // Legacy support - redirect to framework server for consistency
            logger.warning("fileUrl transport type deprecated, using framework server")
            return processWithFrameworkServer(fileURL: fileURL, decision: decision, mimeType: mimeType, options: options)
        }
    }

    // MARK: - Base64 Processing

    private static func processWithBase64(fileURL: URL, decision: TransportDecision, mimeType: String, options: [String: Any]) -> CameraProcessingResult {
        do {
            let imageData = try Data(contentsOf: fileURL)

            // Apply quality compression if specified
            let processedData = applyQualityCompression(data: imageData, options: options, mimeType: mimeType)
            let base64String = processedData.base64EncodedString()
            let dataUri = "data:\(mimeType);base64,\(base64String)"

            logger.debug("Successfully processed file with base64 transport")

            return CameraProcessingResult.success(
                fileName: decision.fileName,
                fileSrc: dataUri,
                filePath: decision.filePath,
                fileSize: Int64(processedData.count),
                mimeType: mimeType,
                transportUsed: .base64
            )

        } catch {
            logger.error("Base64 processing failed: \(error.localizedDescription)")
            return CameraProcessingResult.failure(error: "Base64 encoding failed: \(error.localizedDescription)")
        }
    }

    // MARK: - File URL Processing

    private static func processWithFileUrl(fileURL: URL, decision: TransportDecision, mimeType: String, options: [String: Any]) -> CameraProcessingResult {
        do {
            // Create accessible file URL for WebView
            let accessibleURL = try createAccessibleFileUrl(from: fileURL, options: options)

            logger.debug("Successfully processed file with file URL transport")

            return CameraProcessingResult.success(
                fileName: decision.fileName,
                fileSrc: accessibleURL.absoluteString,
                filePath: accessibleURL.path,
                fileSize: decision.fileSize,
                mimeType: mimeType,
                transportUsed: .fileUrl
            )

        } catch {
            logger.error("File URL processing failed: \(error.localizedDescription)")
            return CameraProcessingResult.failure(error: "File URL processing failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Framework Server Processing

    private static func processWithFrameworkServer(fileURL: URL, decision: TransportDecision, mimeType: String, options: [String: Any]) -> CameraProcessingResult {
        logger.info("Processing file with framework server transport")

        let frameworkServer = FrameworkServerUtils.shared

        // Ensure framework server is running
        if !frameworkServer.isRunning() {
            logger.info("Framework server not running, starting server...")
            if !frameworkServer.startServer() {
                logger.error("Failed to start framework server, falling back to file URL")
                return fallbackToFileUrlProcessing(fileURL: fileURL, decision: decision, mimeType: mimeType, options: options)
            }
        }

        // Copy file to server cache and get serving URL
        guard let serverUrl = frameworkServer.copyAndServeFile(
            originalFile: fileURL,
            fileName: decision.fileName,
            mimeType: mimeType
        ) else {
            logger.error("Failed to add file to framework server, falling back to file URL")
            return fallbackToFileUrlProcessing(fileURL: fileURL, decision: decision, mimeType: mimeType, options: options)
        }

        logger.debug("Successfully processed file with framework server: \(serverUrl)")

        return CameraProcessingResult.success(
            fileName: decision.fileName,
            fileSrc: serverUrl,
            filePath: fileURL.path,
            fileSize: decision.fileSize,
            mimeType: mimeType,
            transportUsed: .frameworkServer
        )
    }

    // MARK: - Fallback Processing

    private static func fallbackToFileUrlProcessing(fileURL: URL, decision: TransportDecision, mimeType: String, options: [String: Any]) -> CameraProcessingResult {
        do {
            // Create accessible file URL for WebView (iOS file:// URL with proper permissions)
            let accessibleURL = try createAccessibleFileUrl(from: fileURL, options: options)

            logger.debug("Successfully processed file with file URL fallback")

            return CameraProcessingResult.success(
                fileName: decision.fileName,
                fileSrc: accessibleURL.absoluteString,
                filePath: accessibleURL.path,
                fileSize: decision.fileSize,
                mimeType: mimeType,
                transportUsed: .fileUrl
            )

        } catch {
            logger.error("File URL fallback failed: \(error.localizedDescription)")
            return CameraProcessingResult.failure(error: "Framework server and file URL fallback both failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Helper Methods

    /**
     * Apply quality compression based on options
     */
    private static func applyQualityCompression(data: Data, options: [String: Any], mimeType: String) -> Data {
        // Only apply compression for JPEG images
        guard mimeType.contains("jpeg") || mimeType.contains("jpg"),
              let image = UIImage(data: data) else {
            return data
        }

        // Determine compression quality using unified constants
        let quality: CGFloat
        if let qualityString = options["quality"] as? String {
            switch qualityString.lowercased() {
            case "high":
                quality = CatalystConstants.ImageProcessing.Quality.high
            case "low":
                quality = CatalystConstants.ImageProcessing.Quality.low
            case "medium":
                quality = CatalystConstants.ImageProcessing.Quality.medium
            default:
                quality = CatalystConstants.ImageProcessing.defaultQuality
            }
        } else {
            quality = CatalystConstants.ImageProcessing.defaultQuality
        }

        if let compressedData = image.jpegData(compressionQuality: quality) {
            logger.debug("Applied JPEG compression with quality: \(quality)")
            return compressedData
        }

        return data
    }

    /**
     * Create accessible file URL for WebView consumption
     */
    private static func createAccessibleFileUrl(from fileURL: URL, options: [String: Any]) throws -> URL {
        // For iOS, we'll use the file URL directly
        // In production, this might involve copying to a web-accessible directory
        return fileURL
    }

    /**
     * Get MIME type for file
     */
    private static func getMimeType(for fileURL: URL) -> String {
        let pathExtension = fileURL.pathExtension.lowercased()

        switch pathExtension {
        case "jpg", "jpeg":
            return "image/jpeg"
        case "png":
            return "image/png"
        case "gif":
            return "image/gif"
        case "webp":
            return "image/webp"
        default:
            return "image/jpeg" // Default for camera images
        }
    }

    /**
     * Format file size for logging
     */
    static func formatFileSize(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}