import XCTest
import Foundation
@testable import CatalystCoreLogic

/// Loopback tests for the native-AI routes (/ai/stream, /ai/generate) using a stub supplier,
/// so the transport is covered without any inference library. Mirrors the pattern in
/// FrameworkServerUtilsLoopbackTests (skip outside CI if the sandbox cannot bind, fail on CI).
final class FrameworkServerUtilsNativeAITests: XCTestCase {

    private var server: FrameworkServerUtils!

    override func setUp() {
        super.setUp()
        server = FrameworkServerUtils.shared
    }

    override func tearDown() {
        server.setNativeAiSupplier(nil)
        server.setNativeSystemPrompt("")
        server.stopServer()
        server = nil
        super.tearDown()
    }

    // MARK: - Helpers

    private func requireRunningServer() throws {
        guard server.startServer() else { return try unavailable("startServer() returned false") }
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if server.isRunning(), Self.canConnect(port: server.getServerPort()) { return }
            Thread.sleep(forTimeInterval: 0.02)
        }
        try unavailable("not accepting connections")
    }

    private func unavailable(_ reason: String) throws {
        if ProcessInfo.processInfo.environment["CI"] != nil {
            XCTFail("Loopback server unavailable: \(reason)")
            throw XCTSkip("unavailable")
        }
        throw XCTSkip("Loopback server unavailable: \(reason)")
    }

    private static func canConnect(port: UInt16) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd != -1 else { return false }
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        } == 0
    }

    private func url(_ path: String) throws -> URL {
        try XCTUnwrap(URL(string: "http://localhost:\(server.getServerPort())/framework-\(server.getSessionId())/ai/\(path)"))
    }

    private func post(_ path: String, json: [String: Any]) async throws -> URLRequest {
        var request = URLRequest(url: try url(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: json)
        return request
    }

    private func readFrames(_ request: URLRequest) async throws -> (HTTPURLResponse, [[String: Any]]) {
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        var frames: [[String: Any]] = []
        for try await line in bytes.lines where line.hasPrefix("data: ") {
            let payload = Data(line.dropFirst(6).utf8)
            frames.append(try XCTUnwrap(JSONSerialization.jsonObject(with: payload) as? [String: Any]))
        }
        return (try XCTUnwrap(response as? HTTPURLResponse), frames)
    }

    private func stubSupplier(tokens: [String], conversationId: String = "conv-1") -> NativeAISupplier {
        return { _, _, _ in
            (conversationId, AsyncThrowingStream { continuation in
                for token in tokens { continuation.yield(token) }
                continuation.finish()
            })
        }
    }

    // MARK: - /ai/stream

    func testStream_EmitsConversationIdTokensThenDone() async throws {
        try requireRunningServer()
        server.setNativeAiSupplier(stubSupplier(tokens: ["Hel", "lo \"quoted\" / ✓"]))

        let (response, frames) = try await readFrames(try await post("stream", json: ["prompt": "hi"]))

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertTrue(response.value(forHTTPHeaderField: "Content-Type")?.contains("text/event-stream") ?? false)
        XCTAssertEqual(frames.count, 4)
        XCTAssertEqual(frames[0]["conversationId"] as? String, "conv-1")
        XCTAssertEqual(frames[1]["token"] as? String, "Hel")
        XCTAssertEqual(frames[2]["token"] as? String, "lo \"quoted\" / ✓")
        XCTAssertEqual(frames[3]["done"] as? Bool, true)
    }

    func testStream_PrependsSystemPromptAndForwardsGenConfigAndConversationId() async throws {
        try requireRunningServer()
        let seen = LockedBox<(String, [String: Any], String?)?>(nil)
        server.setNativeSystemPrompt("SYSTEM")
        server.setNativeAiSupplier { prompt, genConfig, convId in
            seen.value = (prompt, genConfig, convId)
            return ("c", AsyncThrowingStream { $0.finish() })
        }

        _ = try await readFrames(try await post("stream", json: [
            "prompt": "hello", "genConfig": ["temperature": 0.5], "conversationId": "prev",
        ]))

        let value = try XCTUnwrap(seen.value)
        XCTAssertEqual(value.0, "SYSTEM\n\nhello")
        XCTAssertEqual(value.1["temperature"] as? Double, 0.5)
        XCTAssertEqual(value.2, "prev")
    }

    func testStream_NoSupplier_EmitsNotReadyErrorFrame() async throws {
        try requireRunningServer()
        let (_, frames) = try await readFrames(try await post("stream", json: ["prompt": "hi"]))
        XCTAssertEqual(frames.first?["code"] as? String, NativeAIErrorCode.streamNotReady)
        XCTAssertNotNil(frames.first?["error"] as? String)
    }

    func testStream_EmptyPrompt_EmitsInvalidRequestFrame() async throws {
        try requireRunningServer()
        server.setNativeAiSupplier(stubSupplier(tokens: ["x"]))
        let (_, frames) = try await readFrames(try await post("stream", json: ["prompt": ""]))
        XCTAssertEqual(frames.first?["code"] as? String, NativeAIErrorCode.invalidRequestBody)
    }

    func testStream_SupplierThrows_EmitsErrorFrameWithEngineCode() async throws {
        try requireRunningServer()
        server.setNativeAiSupplier { _, _, _ in throw NativeAIError(message: "model exploded", code: "AI-006") }
        let (_, frames) = try await readFrames(try await post("stream", json: ["prompt": "hi"]))
        XCTAssertEqual(frames.first?["error"] as? String, "model exploded")
        XCTAssertEqual(frames.first?["code"] as? String, "AI-006")
    }

    func testStream_MidStreamFailure_EmitsTokensThenError() async throws {
        try requireRunningServer()
        server.setNativeAiSupplier { _, _, _ in
            ("c", AsyncThrowingStream { continuation in
                continuation.yield("partial")
                continuation.finish(throwing: NativeAIError(message: "context window exceeded"))
            })
        }
        let (_, frames) = try await readFrames(try await post("stream", json: ["prompt": "hi"]))
        XCTAssertEqual(frames.map { $0.keys.sorted().joined(separator: ",") }, ["conversationId", "token", "code,error"])
    }

    func testStream_TokenArrivingAfterGap_StillDelivered() async throws {
        // Short gap only: the 30s connection-timeout exemption (cancelConnectionTimeout) is not exercised here.
        try requireRunningServer()
        server.setNativeAiSupplier { _, _, _ in
            ("c", AsyncThrowingStream { continuation in
                Task<Void, Never> {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    continuation.yield("late")
                    continuation.finish()
                }
            })
        }
        let (_, frames) = try await readFrames(try await post("stream", json: ["prompt": "hi"]))
        XCTAssertEqual(frames.last?["done"] as? Bool, true)
    }

    func testStream_ClientDisconnect_TerminatesUpstreamStream() async throws {
        try requireRunningServer()
        let terminated = expectation(description: "token stream terminated after client disconnect")
        server.setNativeAiSupplier { _, _, _ in
            ("c", AsyncThrowingStream { continuation in
                continuation.onTermination = { _ in terminated.fulfill() }
                Task<Void, Never> {
                    while !Task.isCancelled {
                        if case .terminated = continuation.yield("tick") { break }
                        try? await Task.sleep(nanoseconds: 20_000_000)
                    }
                }
            })
        }

        let (bytes, _) = try await URLSession.shared.bytes(for: try await post("stream", json: ["prompt": "hi"]))
        var iterator = bytes.lines.makeAsyncIterator()
        _ = try await iterator.next()
        bytes.task.cancel()

        await fulfillment(of: [terminated], timeout: 10)
    }

    // MARK: - Body framing

    func testStream_BodyArrivingInSeparateWriteFromHeaders_IsAssembled() async throws {
        try requireRunningServer()
        server.setNativeAiSupplier(stubSupplier(tokens: ["ok"]))

        let body = #"{"prompt":"split"}"#
        let head = "POST /framework-\(server.getSessionId())/ai/stream HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\n\r\n"
        let reply = try Self.rawExchange(port: server.getServerPort(), writes: [head, body], pauseBetween: 0.2)

        XCTAssertTrue(reply.contains("200 OK"))
        XCTAssertTrue(reply.contains("\"token\":\"ok\""))
        XCTAssertTrue(reply.contains("\"done\":true"))
    }

    func testPost_OversizedContentLength_Returns413() async throws {
        try requireRunningServer()
        let head = "POST /framework-\(server.getSessionId())/ai/stream HTTP/1.1\r\nContent-Length: 99999999\r\n\r\n"
        let reply = try Self.rawExchange(port: server.getServerPort(), writes: [head], pauseBetween: 0)
        XCTAssertTrue(reply.contains("413"))
    }

    /// Writes each chunk on a plain TCP socket (with a pause between), then reads until the server closes.
    private static func rawExchange(port: UInt16, writes: [String], pauseBetween: TimeInterval) throws -> String {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd != -1 else { throw XCTSkip("socket() failed") }
        defer { close(fd) }
        var tv = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connected = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard connected == 0 else { throw XCTSkip("connect() failed") }

        for chunk in writes {
            _ = chunk.withCString { send(fd, $0, strlen($0), 0) }
            if pauseBetween > 0 { Thread.sleep(forTimeInterval: pauseBetween) }
        }

        var received = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = recv(fd, &buffer, buffer.count, 0)
            if n <= 0 { break }
            received.append(buffer, count: n)
        }
        return String(decoding: received, as: UTF8.self)
    }

    // MARK: - OPTIONS preflight / generate / URL

    func testPreflight_ReturnsCORSForPost() async throws {
        try requireRunningServer()
        var request = URLRequest(url: try url("stream"))
        request.httpMethod = "OPTIONS"
        let (_, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        XCTAssertEqual(http.statusCode, 200)
        XCTAssertTrue(http.value(forHTTPHeaderField: "Access-Control-Allow-Methods")?.contains("POST") ?? false)
        XCTAssertNotNil(http.value(forHTTPHeaderField: "Access-Control-Allow-Origin"))
    }

    func testGenerate_ReturnsAggregatedJSON() async throws {
        try requireRunningServer()
        server.setNativeAiSupplier(stubSupplier(tokens: ["a", "b", "c"], conversationId: "g1"))

        let (data, response) = try await URLSession.shared.data(for: try await post("generate", json: ["prompt": "hi"]))

        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["output"] as? String, "abc")
        XCTAssertEqual(json["conversationId"] as? String, "g1")
        XCTAssertEqual(json["tokenCount"] as? Int, 3)
    }

    func testGenerate_NoSupplier_Returns503() async throws {
        try requireRunningServer()
        let (data, response) = try await URLSession.shared.data(for: try await post("generate", json: ["prompt": "hi"]))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 503)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["code"] as? String, NativeAIErrorCode.streamNotReady)
    }

    func testNativeAIStreamURL_NilWhenStopped_AndNamesSessionWhenRunning() throws {
        server.stopServer()
        XCTAssertNil(server.nativeAIStreamURL())
        try requireRunningServer()
        let url = try XCTUnwrap(server.nativeAIStreamURL())
        XCTAssertTrue(url.hasSuffix("/framework-\(server.getSessionId())/ai/stream"))
        XCTAssertTrue(url.contains("localhost:\(server.getServerPort())"))
    }
}

private final class LockedBox<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T
    init(_ initial: T) { stored = initial }
    var value: T {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); defer { lock.unlock() }; stored = newValue }
    }
}
