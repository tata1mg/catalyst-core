//
//  FrameworkServerUtils+Requests.swift
//  iosnativeWebView
//
//  HTTP request assembly (headers + Content-Length body across reads) and routing for the framework server,
//  split out of FrameworkServerUtils.swift to keep that type within the lint limits.
//

import Foundation
import Network
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "FrameworkServer")

extension FrameworkServerUtils {
    /// Completion body of receiveHTTPRequest. Internal so tests can drive the
    /// error branch directly; a real receive error is timing-dependent.
    ///
    /// A POST's headers and body can arrive in separate reads, so bytes are
    /// buffered per connection until the headers end (CRLFCRLF) and Content-Length
    /// bytes of body are present. A GET has no body and dispatches immediately.
    func handleReceivedData(_ data: Data?, isComplete: Bool, error: NWError?, on connection: NWConnection) {
        if let error = error {
            discardPendingRequest(for: connection)
            handleReceiveError(error, on: connection)
            return
        }

        guard let data = data else {
            discardPendingRequest(for: connection)
            sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.badRequest, body: "Bad Request")
            return
        }

        let key = ObjectIdentifier(connection)
        // Append to the connection's own buffer in place: `old + new` would copy every byte received so far on
        // each 8 KB read.
        requestStateLock.lock()
        var buffer = pendingRequests.removeValue(forKey: key) ?? Data()
        buffer.append(data)
        requestStateLock.unlock()

        let terminator = Data("\r\n\r\n".utf8)
        guard let headerEnd = buffer.range(of: terminator) else {
            if buffer.count > Self.maxHeaderBytes {
                discardPendingRequest(for: connection)
                sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.badRequest, body: "Bad Request")
            } else if isComplete {
                // Client closed mid-headers: fall through to the legacy single-read behaviour.
                discardPendingRequest(for: connection)
                dispatchRequest(headerData: buffer, body: Data(), isComplete: isComplete, on: connection)
            } else {
                requestStateLock.lock(); pendingRequests[key] = buffer; requestStateLock.unlock()
                receiveHTTPRequest(on: connection)
            }
            return
        }

        let headerData = buffer[buffer.startIndex..<headerEnd.lowerBound]
        let body = buffer[headerEnd.upperBound...]
        guard let expected = Self.contentLength(inHeaders: headerData) else {
            discardPendingRequest(for: connection)
            sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.badRequest, body: "Bad Request")
            return
        }

        if expected > Self.maxBodyBytes {
            discardPendingRequest(for: connection)
            sendHTTPResponse(on: connection, statusCode: 413, body: "Payload Too Large")
            return
        }
        if body.count < expected {
            if isComplete {
                // The client closed the connection before sending the declared body: reject rather than
                // handle a truncated request.
                discardPendingRequest(for: connection)
                sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.badRequest, body: "Bad Request")
                return
            }
            requestStateLock.lock(); pendingRequests[key] = buffer; requestStateLock.unlock()
            receiveHTTPRequest(on: connection)
            return
        }

        discardPendingRequest(for: connection)
        dispatchRequest(headerData: Data(headerData), body: Data(body.prefix(max(expected, 0))), isComplete: isComplete, on: connection)
    }

    func discardPendingRequest(for connection: NWConnection) {
        requestStateLock.lock()
        pendingRequests.removeValue(forKey: ObjectIdentifier(connection))
        requestStateLock.unlock()
    }

    /// The declared body length: 0 when there is no Content-Length header, nil when it is malformed or negative
    /// (the request is then rejected instead of being read as an empty body).
    static func contentLength(inHeaders headerData: Data) -> Int? {
        guard let text = String(data: headerData, encoding: .utf8) else { return nil }
        for line in text.components(separatedBy: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" {
                guard let length = Int(parts[1].trimmingCharacters(in: .whitespaces)), length >= 0 else { return nil }
                return length
            }
        }
        return 0
    }

    /// True when the peer is on this device. The listener is not bound to loopback only (that predates the AI
    /// routes and also serves files), so the AI routes — which run the on-device model — check the peer themselves.
    static func isLoopbackPeer(_ endpoint: NWEndpoint) -> Bool {
        guard case let .hostPort(host, _) = endpoint else { return false }
        switch host {
        case .ipv4(let address):
            return address.isLoopback
        case .ipv6(let address):
            return address.isLoopback || address.asIPv4?.isLoopback == true
        case .name(let name, _):
            return name == "localhost"
        @unknown default:
            return false
        }
    }

    func dispatchRequest(headerData: Data, body: Data, isComplete: Bool, on connection: NWConnection) {
        guard let requestString = String(data: headerData, encoding: .utf8) else {
            sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.badRequest, body: "Bad Request")
            return
        }

        let keepOpen = processHTTPRequest(requestString, body: body, on: connection)

        // A client half-closing after sending its request must not kill an SSE stream we are still writing.
        if isComplete && !keepOpen {
            connection.cancel()
        }
    }

    /// Returns true when the connection is now owned by a long-lived AI stream and must stay open.
    @discardableResult
    func processHTTPRequest(_ requestString: String, body: Data = Data(), on connection: NWConnection) -> Bool {
        let lines = requestString.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.badRequest, body: "Bad Request")
            return false
        }

        let components = requestLine.components(separatedBy: " ")
        guard components.count >= 2 else {
            sendHTTPResponse(on: connection, statusCode: 405, body: "Method Not Allowed")
            return false
        }

        let method = components[0]
        let aiPrefix = "/framework-\(self.sessionId)/ai/"
        let isAIRoute = components[1] == aiPrefix + "stream" || components[1] == aiPrefix + "generate"

        if isAIRoute {
            guard Self.isLoopbackPeer(connection.endpoint) else {
                logger.warning("Rejected AI request from a non-loopback peer")
                sendHTTPResponse(on: connection, statusCode: 403, body: "Forbidden")
                return false
            }
            switch method {
            case "OPTIONS":
                sendAIPreflight(on: connection)
                return false
            case "POST":
                if components[1] == aiPrefix + "stream" {
                    startAIStream(NativeAIRequest(body: body), on: connection)
                    return true
                }
                runAIGenerate(NativeAIRequest(body: body), on: connection)
                return true
            default:
                sendHTTPResponse(on: connection, statusCode: 405, body: "Method Not Allowed")
                return false
            }
        }

        guard method == "GET" else {
            sendHTTPResponse(on: connection, statusCode: 405, body: "Method Not Allowed")
            return false
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
            return false
        }

        // Handle file requests
        if path.hasPrefix("/framework-\(self.sessionId)/file-") {
            let fileId = String(path.dropFirst("/framework-\(self.sessionId)/file-".count))
            serveFile(fileId: fileId, on: connection)
            return false
        }

        // Invalid route
        sendHTTPResponse(on: connection, statusCode: CatalystConstants.ErrorCodes.fileNotFound, body: "Not Found")
        return false
    }
}
