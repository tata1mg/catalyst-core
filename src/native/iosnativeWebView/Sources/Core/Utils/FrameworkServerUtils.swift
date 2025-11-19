//
//  FrameworkServerUtils.swift
//  iosnativeWebView
//
//  iOS Framework Server - HTTP server for serving large files
//  Matches Android's FrameworkServerUtils.kt functionality using NWListener (Network framework)
//

import Foundation
import Network
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "FrameworkServer")

// MARK: - Error Types

enum FrameworkServerError: Error {
    case cacheInitializationFailed(String)
    case dataConversionFailed(String)
    case connectionHandlingFailed(String)

    var localizedDescription: String {
        switch self {
        case .cacheInitializationFailed(let message):
            return "Cache initialization failed: \(message)"
        case .dataConversionFailed(let message):
            return "Data conversion failed: \(message)"
        case .connectionHandlingFailed(let message):
            return "Connection handling failed: \(message)"
        }
    }
}

// MARK: - Data Models

struct ServedFile {
    let file: URL
    let fileName: String
    let mimeType: String
    let fileId: String
    let createdAt: Date

    init(file: URL, fileName: String, mimeType: String, fileId: String) {
        self.file = file
        self.fileName = fileName
        self.mimeType = mimeType
        self.fileId = fileId
        self.createdAt = Date()
    }
}

// Connection wrapper for tracking and timeout management
private class ConnectionWrapper: Hashable {
    let connection: NWConnection
    let createdAt: Date
    private let timeoutWorkItem: DispatchWorkItem

    init(connection: NWConnection, timeout: TimeInterval) {
        self.connection = connection
        self.createdAt = Date()

        // Create timeout work item
        self.timeoutWorkItem = DispatchWorkItem { [weak connection] in
            logger.warning("Connection timeout - closing connection")
            connection?.cancel()
        }

        // Schedule timeout
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timeoutWorkItem)
    }

    func cancelTimeout() {
        timeoutWorkItem.cancel()
    }

    // Hashable implementation
    func hash(into hasher: inout Hasher) {
        hasher.combine(ObjectIdentifier(connection))
    }

    static func == (lhs: ConnectionWrapper, rhs: ConnectionWrapper) -> Bool {
        return lhs.connection === rhs.connection
    }

    deinit {
        cancelTimeout()
    }
}

// MARK: - Framework Server Utils

class FrameworkServerUtils {

    // Constants from unified configuration
    static let FRAMEWORK_PORT_RANGE_START: UInt16 = CatalystConstants.NetworkServer.portRangeStart
    static let FRAMEWORK_PORT_RANGE_END: UInt16 = CatalystConstants.NetworkServer.portRangeEnd
    static let SESSION_TIMEOUT_SECONDS: TimeInterval = CatalystConstants.NetworkServer.sessionTimeout

    // Singleton instance
    static let shared = FrameworkServerUtils()

    // Server state
    private var listener: NWListener?
    private var serverPort: UInt16 = 0
    private var sessionId: String = ""
    private var isServerRunning: Bool = false

    // Connection management
    private var activeConnections: Set<ConnectionWrapper> = []
    private let connectionQueue = DispatchQueue(label: "framework.server.connections")
    private let maxConnections = CatalystConstants.NetworkServer.maxConnections
    private let connectionTimeoutSeconds: TimeInterval = CatalystConstants.NetworkServer.connectionTimeout

    // CORS configuration - store the base URL from WebView
    private var allowedOrigin: String = "*"

    // File management
    private var servedFiles: [String: ServedFile] = [:]
    private let fileQueue = DispatchQueue(label: "framework.server.files", attributes: .concurrent)

    // Cache directory
    private var cacheDirectory: URL?

    // Cleanup timer
    private var cleanupTimer: Timer?

    private init() {}

    // MARK: - Public API

    /**
     * Initialize and start the framework server
     * @return Boolean indicating success/failure of server startup
     */
    func startServer() -> Bool {
        logger.debug("Starting framework server...")

        if self.isServerRunning {
            logger.debug("Server already running on port \(self.serverPort)")
            return true
        }

        do {
            // Initialize cache directory
            try initializeCacheDirectory()

            // Generate session ID
            self.sessionId = generateSessionId()
            logger.debug("Generated session ID: \(self.sessionId)")

            // Find available port and start server
            guard let availablePort = findAvailablePort() else {
                logger.error("No available ports found in range \(Self.FRAMEWORK_PORT_RANGE_START)-\(Self.FRAMEWORK_PORT_RANGE_END)")
                return false
            }

            self.serverPort = availablePort
            logger.debug("Found available port: \(self.serverPort)")

            // Start NWListener server
            try startNWServer()

            self.isServerRunning = true
            logger.info("Framework server started successfully on port \(self.serverPort) with session \(self.sessionId)")

            // Start cleanup task
            startCleanupTask()

            return true

        } catch {
            logger.error("Failed to start framework server: \(error.localizedDescription)")
            return false
        }
    }

    /**
     * Stop the framework server and cleanup resources
     */
    func stopServer() {
        logger.debug("Stopping framework server...")

        // Cancel all active connections
        connectionQueue.sync {
            for wrapper in self.activeConnections {
                wrapper.connection.cancel()
                wrapper.cancelTimeout()
            }
            self.activeConnections.removeAll()
        }

        listener?.cancel()
        listener = nil
        isServerRunning = false

        // Stop cleanup timer
        cleanupTimer?.invalidate()
        cleanupTimer = nil

        // Cleanup served files
        cleanupAllFiles()

        logger.info("Framework server stopped successfully")
    }

    /**
     * Update allowed CORS origin from current WebView URL
     * @param url The current URL loaded in the WebView
     */
    func updateAllowedOrigin(from url: String) {
        guard !url.isEmpty else {
            logger.warning("Empty URL provided for CORS origin, using wildcard")
            self.allowedOrigin = "*"
            return
        }

        // Extract protocol, host and port from URL
        // e.g., "http://192.168.0.104:3005/path" -> "http://192.168.0.104:3005"
        if let urlComponents = URLComponents(string: url) {
            var origin = ""
            if let scheme = urlComponents.scheme {
                origin += "\(scheme)://"
            }
            if let host = urlComponents.host {
                origin += host
            }
            if let port = urlComponents.port {
                origin += ":\(port)"
            }

            if !origin.isEmpty {
                self.allowedOrigin = origin
                logger.debug("Updated CORS allowed origin to: \(origin)")
            } else {
                self.allowedOrigin = "*"
                logger.warning("Could not extract origin from URL, using wildcard")
            }
        } else {
            self.allowedOrigin = "*"
            logger.warning("Could not parse URL for CORS origin, using wildcard")
        }
    }

    /**
     * Add a file to be served by the framework server
     * @param file File URL to serve
     * @param fileName Display name for the file
     * @param mimeType MIME type of the file
     * @return URL where the file can be accessed
     */
    func addFileToServe(file: URL, fileName: String, mimeType: String) -> String? {
        guard isServerRunning else {
            logger.error("Cannot add file to serve - server not running")
            return nil
        }

        // Validate file path for security
        guard validateFilePath(file) else {
            logger.error("Invalid file path - potential security risk: \(file.path)")
            return nil
        }

        let fileId = generateFileId()
        let servedFile = ServedFile(file: file, fileName: fileName, mimeType: mimeType, fileId: fileId)

        fileQueue.async(flags: .barrier) {
            self.servedFiles[fileId] = servedFile
        }

        let fileUrl = "http://localhost:\(self.serverPort)/framework-\(self.sessionId)/file-\(fileId)"
        logger.debug("Added file to serve: \(fileName) -> \(fileUrl)")

        return fileUrl
    }

    /**
     * Copy a file to cache directory and prepare it for serving
     * @param originalFile Original file URL to copy
     * @param fileName Display name
     * @param mimeType MIME type
     * @return URL where the file can be accessed, or nil if failed
     */
    func copyAndServeFile(originalFile: URL, fileName: String, mimeType: String) -> String? {
        guard isServerRunning, let cacheDirectory = cacheDirectory else {
            logger.error("Cannot copy and serve file - server not running or cache not initialized")
            return nil
        }

        do {
            let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
            let cachedFile = cacheDirectory.appendingPathComponent("\(timestamp)_\(fileName)")

            try FileManager.default.copyItem(at: originalFile, to: cachedFile)
            logger.debug("Copied file to cache: \(originalFile.path) -> \(cachedFile.path)")

            return addFileToServe(file: cachedFile, fileName: fileName, mimeType: mimeType)

        } catch {
            logger.error("Failed to copy file to cache: \(error.localizedDescription)")
            return nil
        }
    }

    /**
     * Remove a file from serving
     * @param fileId File ID to remove
     */
    func removeServedFile(fileId: String) {
        fileQueue.async(flags: .barrier) {
            if let servedFile = self.servedFiles.removeValue(forKey: fileId) {
                // Delete cached file if it's in our cache directory
                if let cacheDirectory = self.cacheDirectory,
                   servedFile.file.path.hasPrefix(cacheDirectory.path) {
                    do {
                        try FileManager.default.removeItem(at: servedFile.file)
                        logger.debug("Deleted cached file: \(servedFile.file.path)")
                    } catch {
                        logger.warning("Failed to delete cached file: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    /**
     * Check if server is running
     */
    func isRunning() -> Bool {
        return isServerRunning
    }

    /**
     * Get server port
     */
    func getServerPort() -> UInt16 {
        return serverPort
    }

    /**
     * Get current session ID
     */
    func getSessionId() -> String {
        return sessionId
    }

    // MARK: - Private Implementation

    /**
     * Validate file path for security - prevent path traversal attacks
     */
    private func validateFilePath(_ fileUrl: URL) -> Bool {
        guard let cacheDirectory = cacheDirectory else {
            logger.error("Cache directory not initialized")
            return false
        }

        // Resolve symbolic links and relative paths
        let resolvedPath = fileUrl.resolvingSymlinksInPath().standardized
        let cachePath = cacheDirectory.resolvingSymlinksInPath().standardized
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.resolvingSymlinksInPath().standardized

        // Allow files in cache directory, documents directory, or app bundle
        let allowedPaths = [
            cachePath.path,
            documentsPath?.path ?? "",
            Bundle.main.bundlePath
        ].filter { !$0.isEmpty }

        for allowedPath in allowedPaths {
            if resolvedPath.path.hasPrefix(allowedPath) {
                logger.debug("File path validated: \(resolvedPath.path)")
                return true
            }
        }

        logger.warning("File path validation failed - outside allowed directories: \(resolvedPath.path)")
        return false
    }

    private func initializeCacheDirectory() throws {
        guard let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            logger.error("Failed to get documents directory for cache initialization")
            throw FrameworkServerError.cacheInitializationFailed("Documents directory unavailable")
        }

        self.cacheDirectory = documentsDirectory.appendingPathComponent("framework_server_files", isDirectory: true)

        guard let cacheDirectory = self.cacheDirectory else {
            logger.error("Failed to create cache directory path")
            throw FrameworkServerError.cacheInitializationFailed("Cache directory path creation failed")
        }

        if !FileManager.default.fileExists(atPath: cacheDirectory.path) {
            try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
            logger.debug("Created cache directory: \(cacheDirectory.path)")
        } else {
            logger.debug("Cache directory already exists: \(cacheDirectory.path)")
        }
    }

    private func generateSessionId() -> String {
        let bytes = (0..<16).map { _ in UInt8.random(in: 0...255) }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func generateFileId() -> String {
        return UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12).lowercased()
    }

    private func findAvailablePort() -> UInt16? {
        for port in Self.FRAMEWORK_PORT_RANGE_START...Self.FRAMEWORK_PORT_RANGE_END {
            if isPortAvailable(port: port) {
                return port
            }
        }
        return nil
    }

    private func isPortAvailable(port: UInt16) -> Bool {
        let socketFD = socket(AF_INET, SOCK_STREAM, 0)
        guard socketFD != -1 else { return false }

        defer { close(socketFD) }

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = INADDR_ANY

        let result = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(socketFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }

        return result == 0
    }

    private func startNWServer() throws {
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true

        // Bind to localhost only for security
        let host = NWEndpoint.Host("127.0.0.1")
        let port = NWEndpoint.Port(integerLiteral: serverPort)
        parameters.requiredLocalEndpoint = .hostPort(host: host, port: port)

        listener = try NWListener(using: parameters, on: port)

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleNewConnection(connection)
        }

        listener?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                logger.debug("NW server ready on port \(self?.serverPort ?? 0)")
            case .failed(let error):
                logger.error("NW server failed: \(error.localizedDescription)")
                self?.isServerRunning = false
            case .cancelled:
                logger.debug("NW server cancelled")
                self?.isServerRunning = false
            default:
                break
            }
        }

        listener?.start(queue: .global(qos: .utility))
    }

    private func handleNewConnection(_ connection: NWConnection) {
        // Check connection limits
        connectionQueue.sync {
            guard self.activeConnections.count < self.maxConnections else {
                logger.warning("Connection limit reached (\(self.maxConnections)), rejecting new connection")
                connection.cancel()
                return
            }

            // Add connection to tracking
            let wrapper = ConnectionWrapper(connection: connection, timeout: self.connectionTimeoutSeconds)
            self.activeConnections.insert(wrapper)

            connection.stateUpdateHandler = { [weak self, weak wrapper] state in
                switch state {
                case .ready:
                    self?.receiveHTTPRequest(on: connection)
                case .failed(let error):
                    logger.debug("Connection failed: \(error.localizedDescription)")
                    if let wrapper = wrapper {
                        self?.removeConnection(wrapper)
                    }
                    connection.cancel()
                case .cancelled:
                    logger.debug("Connection cancelled")
                    if let wrapper = wrapper {
                        self?.removeConnection(wrapper)
                    }
                default:
                    break
                }
            }

            connection.start(queue: .global(qos: .utility))
        }
    }

    private func removeConnection(_ wrapper: ConnectionWrapper) {
        connectionQueue.sync {
            self.activeConnections.remove(wrapper)
            wrapper.cancelTimeout()
        }
    }

    private func receiveHTTPRequest(on connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, isComplete, error in

            if let error = error {
                logger.error("Error receiving request: \(error.localizedDescription)")
                connection.cancel()
                return
            }

            guard let data = data, let requestString = String(data: data, encoding: .utf8) else {
                self?.sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.badRequest, body: "Bad Request")
                return
            }

            self?.processHTTPRequest(requestString, on: connection)

            if isComplete {
                connection.cancel()
            }
        }
    }

    private func processHTTPRequest(_ requestString: String, on connection: NWConnection) {
        let lines = requestString.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.badRequest, body: "Bad Request")
            return
        }

        let components = requestLine.components(separatedBy: " ")
        guard components.count >= 2, components[0] == "GET" else {
            sendHTTPResponse(on: connection, statusCode: 405, body: "Method Not Allowed")
            return
        }

        let path = components[1]

        // Handle status endpoint
        if path == "/framework-\(self.sessionId)/status" {
            fileQueue.sync {
                let statusResponse = """
                {
                    "status": "running",
                    "sessionId": "\(self.sessionId)",
                    "port": \(self.serverPort),
                    "servedFiles": \(self.servedFiles.count)
                }
                """
                sendHTTPResponse(on: connection, statusCode: 200, body: statusResponse, contentType: "application/json")
            }
            return
        }

        // Handle file requests
        if path.hasPrefix("/framework-\(self.sessionId)/file-") {
            let fileId = String(path.dropFirst("/framework-\(self.sessionId)/file-".count))
            serveFile(fileId: fileId, on: connection)
            return
        }

        // Invalid route
        sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.fileNotFound, body: "Not Found")
    }

    private func serveFile(fileId: String, on connection: NWConnection) {
        fileQueue.sync {
            guard let servedFile = self.servedFiles[fileId] else {
                logger.warning("File not found for fileId: \(fileId)")
                self.sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.fileNotFound, body: "File not found")
                return
            }

            guard FileManager.default.fileExists(atPath: servedFile.file.path) else {
                logger.warning("Physical file not found: \(servedFile.file.path)")
                self.servedFiles.removeValue(forKey: fileId)
                self.sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.fileNotFound, body: "Physical file not found")
                return
            }

            // Get file size for streaming
            do {
                let fileAttributes = try FileManager.default.attributesOfItem(atPath: servedFile.file.path)
                let fileSize = fileAttributes[.size] as? Int64 ?? 0

                logger.debug("Serving file: \(servedFile.fileName) (\(fileSize) bytes)")

                // Send headers first
                self.sendHTTPHeaders(on: connection, statusCode: 200,
                                   contentLength: Int(fileSize),
                                   contentType: servedFile.mimeType,
                                   fileName: servedFile.fileName)

                // Stream file content
                self.streamFileContent(file: servedFile.file, connection: connection)

            } catch {
                logger.error("Error getting file attributes: \(error.localizedDescription)")
                self.sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.internalServerError, body: "Internal Server Error")
            }
        }
    }

    private func sendHTTPHeaders(on connection: NWConnection, statusCode: Int,
                                contentLength: Int, contentType: String, fileName: String) {
        let statusText = HTTPURLResponse.localizedString(forStatusCode: statusCode)
        var response = "HTTP/1.1 \(statusCode) \(statusText)\r\n"

        // Add CORS headers
        response += "Access-Control-Allow-Origin: \(allowedOrigin)\r\n"
        response += "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
        response += "Access-Control-Allow-Headers: *\r\n"

        // Add headers
        response += "Content-Type: \(contentType)\r\n"
        response += "Content-Length: \(contentLength)\r\n"
        response += "Content-Disposition: inline; filename=\"\(fileName)\"\r\n"
        response += "Cache-Control: no-cache, no-store, must-revalidate\r\n"
        response += "X-Content-Type-Options: nosniff\r\n"
        response += "X-Frame-Options: DENY\r\n"
        response += "Connection: close\r\n"
        response += "\r\n"

        guard let headerData = response.data(using: .utf8) else {
            logger.error("Failed to convert response headers to UTF-8 data")
            sendErrorResponse(connection: connection, statusCode: CatalystConstants.ErrorCodes.internalServerError, errorMessage: "Internal server error")
            return
        }

        connection.send(content: headerData, completion: .contentProcessed { error in
            if let error = error {
                logger.error("Error sending headers: \(error.localizedDescription)")
                connection.cancel()
            }
        })
    }

    private func streamFileContent(file: URL, connection: NWConnection) {
        do {
            let fileHandle = try FileHandle(forReadingFrom: file)

            // Stream in 8KB chunks for memory efficiency
            streamFileChunk(fileHandle: fileHandle, connection: connection)

        } catch {
            logger.error("Error opening file for streaming: \(error.localizedDescription)")
            connection.cancel()
        }
    }

    private func streamFileChunk(fileHandle: FileHandle, connection: NWConnection) {
        let chunkSize = 8192 // 8KB chunks

        let chunk = fileHandle.readData(ofLength: chunkSize)

        if chunk.isEmpty {
            // End of file reached
            fileHandle.closeFile()
            connection.cancel()
            return
        }

        connection.send(content: chunk, completion: .contentProcessed { [weak self] error in
            if let error = error {
                logger.error("Error streaming file chunk: \(error.localizedDescription)")
                fileHandle.closeFile()
                connection.cancel()
                return
            }

            // Continue streaming next chunk
            self?.streamFileChunk(fileHandle: fileHandle, connection: connection)
        })
    }

    private func sendHTTPResponse(on connection: NWConnection, statusCode: Int, body: String, contentType: String = "text/plain") {
        let bodyData = body.data(using: .utf8) ?? Data()
        sendHTTPResponse(on: connection, statusCode: statusCode, body: bodyData, headers: ["Content-Type": contentType])
    }

    private func sendHTTPResponse(on connection: NWConnection, statusCode: Int, body: Data, headers: [String: String] = [:]) {
        let statusText = HTTPURLResponse.localizedString(forStatusCode: statusCode)
        var response = "HTTP/1.1 \(statusCode) \(statusText)\r\n"

        // Add CORS headers
        response += "Access-Control-Allow-Origin: \(allowedOrigin)\r\n"
        response += "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
        response += "Access-Control-Allow-Headers: *\r\n"

        // Add default headers
        response += "Content-Length: \(body.count)\r\n"
        response += "Connection: close\r\n"

        // Add custom headers
        for (key, value) in headers {
            response += "\(key): \(value)\r\n"
        }

        response += "\r\n"

        guard let responseHeaderData = response.data(using: .utf8) else {
            logger.error("Failed to convert response data to UTF-8")
            sendErrorResponse(connection: connection, statusCode: CatalystConstants.ErrorCodes.internalServerError, errorMessage: "Internal server error")
            return
        }
        let responseData = responseHeaderData + body

        connection.send(content: responseData, completion: .contentProcessed { error in
            if let error = error {
                logger.debug("Error sending response: \(error.localizedDescription)")
            }
            connection.cancel()
        })
    }

    private func sendErrorResponse(connection: NWConnection, statusCode: Int, errorMessage: String) {
        logger.error("Sending error response: \(statusCode) - \(errorMessage)")

        let jsonError: [String: Any] = [
            "error": errorMessage,
            "code": statusCode,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]

        do {
            let jsonData = try JSONSerialization.data(withJSONObject: jsonError, options: [])
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                sendHTTPResponse(on: connection, statusCode: statusCode, body: jsonString, contentType: "application/json")
            } else {
                // Fallback to plain text if JSON conversion fails
                sendHTTPResponse(on: connection, statusCode: statusCode, body: errorMessage, contentType: "text/plain")
            }
        } catch {
            // Ultimate fallback to plain text
            sendHTTPResponse(on: connection, statusCode: statusCode, body: errorMessage, contentType: "text/plain")
        }
    }

    private func startCleanupTask() {
        cleanupTimer = Timer.scheduledTimer(withTimeInterval: CatalystConstants.NetworkServer.cleanupInterval, repeats: true) { [weak self] _ in
            self?.cleanupExpiredFiles()
        }
    }

    private func cleanupExpiredFiles() {
        let currentTime = Date()

        fileQueue.async(flags: .barrier) {
            let expiredFileIds = self.servedFiles.compactMap { (fileId, servedFile) in
                currentTime.timeIntervalSince(servedFile.createdAt) > Self.SESSION_TIMEOUT_SECONDS ? fileId : nil
            }

            if !expiredFileIds.isEmpty {
                logger.debug("Cleaning up \(expiredFileIds.count) expired files")

                for fileId in expiredFileIds {
                    if let servedFile = self.servedFiles.removeValue(forKey: fileId) {
                        // Delete cached file if it's in our cache directory
                        if let cacheDirectory = self.cacheDirectory,
                           servedFile.file.path.hasPrefix(cacheDirectory.path) {
                            do {
                                try FileManager.default.removeItem(at: servedFile.file)
                                logger.debug("Deleted expired cached file: \(servedFile.file.path)")
                            } catch {
                                logger.warning("Failed to delete expired cached file: \(error.localizedDescription)")
                            }
                        }
                    }
                }
            }
        }
    }

    private func cleanupAllFiles() {
        fileQueue.async(flags: .barrier) {
            logger.debug("Cleaning up all served files (\(self.servedFiles.count) files)")
            let fileIds = Array(self.servedFiles.keys)

            for fileId in fileIds {
                if let servedFile = self.servedFiles.removeValue(forKey: fileId) {
                    // Delete cached file if it's in our cache directory
                    if let cacheDirectory = self.cacheDirectory,
                       servedFile.file.path.hasPrefix(cacheDirectory.path) {
                        do {
                            try FileManager.default.removeItem(at: servedFile.file)
                            logger.debug("Deleted cache file: \(servedFile.fileName)")
                        } catch {
                            logger.warning("Failed to delete cache file: \(servedFile.fileName), \(error.localizedDescription)")
                        }
                    }
                }
            }

            // Clean cache directory
            if let cacheDirectory = self.cacheDirectory,
               let files = try? FileManager.default.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: nil) {
                for file in files {
                    do {
                        try FileManager.default.removeItem(at: file)
                        logger.debug("Deleted cache file: \(file.lastPathComponent)")
                    } catch {
                        logger.warning("Failed to delete cache file: \(file.lastPathComponent), \(error.localizedDescription)")
                    }
                }
            }
        }
    }
}
