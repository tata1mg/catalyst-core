import XCTest
import Foundation
@testable import CatalystCoreLogic

/// Thrown on CI when the loopback server never becomes reachable, so the test
/// fails instead of silently skipping and dropping coverage.
private struct LoopbackServerUnavailable: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

/**
 * In-process loopback HTTP tests for FrameworkServerUtils.
 *
 * The existing FrameworkServerUtilsTests.swift covers server lifecycle,
 * config, and port/session-id logic, but skips actual request handling
 * (receiveHTTPRequest / processHTTPRequest / serveFile / sendHTTPHeaders /
 * streamFileContent) — that's most of the file's uncovered ~65%. This file
 * makes real HTTP requests over URLSession against http://localhost:<port>
 * to exercise that path directly.
 *
 * Not Tier 2 (#416, scaffolded-app simulator tests) — this stays entirely
 * in-process, no simulator, same package/target as every other CoreLogic
 * test. It's the loopback-client middle ground flagged when the coverage
 * math showed 95% package-wide wasn't reachable while FrameworkServerUtils
 * stayed at ~35%.
 *
 * Each test waits for the listener to accept connections before sending a
 * request (see requireRunningServer). Outside CI, a sandbox that cannot bind
 * skips the test; on CI an unavailable server fails it, so loopback coverage
 * can never silently drop and skew the coverage-regression baseline.
 */
final class FrameworkServerUtilsLoopbackTests: XCTestCase {

    var frameworkServer: FrameworkServerUtils!
    private var tempFileURL: URL?

    override func setUp() {
        super.setUp()
        frameworkServer = FrameworkServerUtils.shared
    }

    override func tearDown() {
        if let tempFileURL {
            try? FileManager.default.removeItem(at: tempFileURL)
        }
        tempFileURL = nil

        // Unconditional: a listener that failed asynchronously reports
        // isRunning() == false but still holds its timer and listener, which
        // must not leak into later tests.
        frameworkServer.stopServer()
        frameworkServer = nil
        super.tearDown()
    }

    /// Starts the server and blocks until it is actually accepting TCP
    /// connections, so no test sends a request before NWListener is `.ready`.
    ///
    /// NWListener reports readiness asynchronously and `startServer()` returns
    /// before it settles, so a fixed sleep is a race that loses on slow CI
    /// runners. Instead this polls a raw loopback connect until it succeeds or
    /// `readinessTimeout` elapses.
    ///
    /// If the server never comes up: on CI (`CI` env var set) the test fails,
    /// because a silent skip would drop the loopback coverage and make the
    /// coverage baseline non-deterministic. Outside CI (e.g. a restricted local
    /// sandbox that cannot bind) it skips, as before.
    private func requireRunningServer() throws {
        let readinessTimeout: TimeInterval = 10

        guard frameworkServer.startServer() else {
            try serverUnavailable("startServer() returned false")
            return
        }

        let deadline = Date().addingTimeInterval(readinessTimeout)
        while Date() < deadline {
            if frameworkServer.isRunning(),
               Self.canConnect(toLoopbackPort: frameworkServer.getServerPort()) {
                return
            }
            Thread.sleep(forTimeInterval: 0.02)
        }
        try serverUnavailable("not accepting connections within \(Int(readinessTimeout))s")
    }

    private func serverUnavailable(_ reason: String) throws {
        let message = "Loopback server unavailable: \(reason)"
        if ProcessInfo.processInfo.environment["CI"] != nil {
            throw LoopbackServerUnavailable(message: message)
        }
        throw XCTSkip("\(message) — skipping loopback test outside CI")
    }

    private static func canConnect(toLoopbackPort port: UInt16) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd != -1 else { return false }
        defer { close(fd) }

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let result = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }

    private func serveTemporaryFile(content: String, fileName: String, mimeType: String) throws -> String? {
        let data = Data(content.utf8)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try data.write(to: url)
        tempFileURL = url

        return frameworkServer.copyAndServeFile(originalFile: url, fileName: fileName, mimeType: mimeType)
    }

    private func makeRequest(
        url: URL,
        method: String = "GET"
    ) async throws -> (HTTPURLResponse, Data) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 5

        let (data, response) = try await URLSession.shared.data(for: request)
        let httpResponse = try XCTUnwrap(response as? HTTPURLResponse)
        return (httpResponse, data)
    }

    /// Opens a raw TCP client to the running server and returns its fd.
    private func openRawClient() throws -> Int32 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        try XCTSkipIf(fd == -1, "could not create client socket")

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = frameworkServer.getServerPort().bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let result = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard result == 0 else {
            close(fd)
            throw LoopbackServerUnavailable(message: "raw client could not connect (errno \(errno))")
        }
        return fd
    }

    /// Polls until `condition` holds or `timeout` elapses. Returns whether it held.
    private func waitUntil(timeout: TimeInterval = 5, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return condition()
    }

    // MARK: - Connection lifecycle

    /// stopServer() must cancel and clear connections that are still open. A
    /// request/response test only hits this when a keep-alive connection
    /// happens to be alive at teardown, which is timing-dependent; holding a
    /// client open here makes that path run every time.
    func testStopServer_WithOpenConnection_ClearsActiveConnections() throws {
        try requireRunningServer()

        let client = try openRawClient()
        defer { close(client) }

        XCTAssertTrue(
            waitUntil { frameworkServer.activeConnectionCount() >= 1 },
            "server never registered the open client connection"
        )

        frameworkServer.stopServer()

        XCTAssertEqual(frameworkServer.activeConnectionCount(), 0)
        XCTAssertFalse(frameworkServer.isRunning())
    }

    /// A client that resets mid-request (RST via zero-linger close) must be
    /// dropped from the tracking set, whichever of the server's failed or
    /// cancelled connection handlers observes it.
    func testClientResetMidRequest_RemovesConnection() throws {
        try requireRunningServer()

        let client = try openRawClient()
        XCTAssertTrue(
            waitUntil { frameworkServer.activeConnectionCount() >= 1 },
            "server never registered the client connection"
        )

        let partialRequest = Array("GET /partial".utf8)
        _ = partialRequest.withUnsafeBytes { send(client, $0.baseAddress, $0.count, 0) }

        var linger = linger(l_onoff: 1, l_linger: 0)
        setsockopt(client, SOL_SOCKET, SO_LINGER, &linger, socklen_t(MemoryLayout<linger>.size))
        close(client)

        XCTAssertTrue(
            waitUntil { frameworkServer.activeConnectionCount() == 0 },
            "connection was not removed after the client reset"
        )
    }

    // MARK: - Status endpoint

    func testStatusEndpoint_ReturnsRunningJSON() async throws {
        try requireRunningServer()

        let port = frameworkServer.getServerPort()
        let sessionId = frameworkServer.getSessionId()
        let statusURL = try XCTUnwrap(URL(string: "http://localhost:\(port)/framework-\(sessionId)/status"))

        let (response, data) = try await makeRequest(url: statusURL)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.value(forHTTPHeaderField: "Content-Type"), "application/json")

        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["status"] as? String, "running")
        XCTAssertEqual(json["sessionId"] as? String, sessionId)
        XCTAssertEqual(json["port"] as? Int, Int(port))
    }

    // MARK: - File serving: success path

    func testFileRequest_ServesRealFileContent() async throws {
        try requireRunningServer()

        let content = "loopback test file content \(UUID().uuidString)"
        let servedURLString = try XCTUnwrap(
            try serveTemporaryFile(content: content, fileName: "loopback-test.txt", mimeType: "text/plain")
        )
        let servedURL = try XCTUnwrap(URL(string: servedURLString))

        let (response, data) = try await makeRequest(url: servedURL)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.value(forHTTPHeaderField: "Content-Type"), "text/plain")
        XCTAssertEqual(String(data: data, encoding: .utf8), content)
    }

    func testFileRequest_ContentLengthHeaderMatchesActualBytes() async throws {
        try requireRunningServer()

        let content = String(repeating: "x", count: 5000)
        let servedURLString = try XCTUnwrap(
            try serveTemporaryFile(content: content, fileName: "loopback-large.txt", mimeType: "text/plain")
        )
        let servedURL = try XCTUnwrap(URL(string: servedURLString))

        let (response, data) = try await makeRequest(url: servedURL)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(data.count, 5000)
        let contentLengthHeader = response.value(forHTTPHeaderField: "Content-Length")
        XCTAssertEqual(contentLengthHeader, "5000")
    }

    // MARK: - File serving: error paths

    func testFileRequest_UnknownFileId_Returns404() async throws {
        try requireRunningServer()

        let port = frameworkServer.getServerPort()
        let sessionId = frameworkServer.getSessionId()
        let url = try XCTUnwrap(URL(string: "http://localhost:\(port)/framework-\(sessionId)/file-does-not-exist"))

        let (response, _) = try await makeRequest(url: url)

        XCTAssertEqual(response.statusCode, 404)
    }

    func testInvalidRoute_Returns404() async throws {
        try requireRunningServer()

        let port = frameworkServer.getServerPort()
        let url = try XCTUnwrap(URL(string: "http://localhost:\(port)/not-a-real-route"))

        let (response, _) = try await makeRequest(url: url)

        XCTAssertEqual(response.statusCode, 404)
    }

    func testNonGETMethod_Returns405() async throws {
        try requireRunningServer()

        let port = frameworkServer.getServerPort()
        let sessionId = frameworkServer.getSessionId()
        let url = try XCTUnwrap(URL(string: "http://localhost:\(port)/framework-\(sessionId)/status"))

        let (response, _) = try await makeRequest(url: url, method: "POST")

        XCTAssertEqual(response.statusCode, 405)
    }

    // MARK: - Physical file missing after being registered (not just unknown id)

    func testFileRequest_PhysicalFileDeletedAfterRegistration_Returns404() async throws {
        try requireRunningServer()

        let servedURLString = try XCTUnwrap(
            try serveTemporaryFile(content: "will be deleted from cache", fileName: "loopback-vanish.txt", mimeType: "text/plain")
        )
        let servedURL = try XCTUnwrap(URL(string: servedURLString))

        // copyAndServeFile copies into a documents-directory cache path
        // deterministically named "<timestamp>_<fileName>" — reconstruct
        // and delete it directly (cacheDirectory itself is private) to
        // simulate the file having vanished between being registered and
        // being requested (servedFile entry still present, physical file
        // gone), exercising serveFile's "Physical file not found" branch
        // rather than addFileToServe's earlier existence checks.
        let documentsDirectory = try XCTUnwrap(
            FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        )
        let cacheDirectory = documentsDirectory.appendingPathComponent("framework_server_files", isDirectory: true)
        let cachedFiles = try FileManager.default.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: nil)
        let vanishedCacheFile = try XCTUnwrap(cachedFiles.first { $0.lastPathComponent.hasSuffix("loopback-vanish.txt") })
        try FileManager.default.removeItem(at: vanishedCacheFile)

        let (response, _) = try await makeRequest(url: servedURL)

        XCTAssertEqual(response.statusCode, 404)
    }

    // MARK: - removeServedFile

    func testRemoveServedFile_SubsequentRequestReturns404() async throws {
        try requireRunningServer()

        let servedURLString = try XCTUnwrap(
            try serveTemporaryFile(content: "to be removed", fileName: "loopback-remove.txt", mimeType: "text/plain")
        )
        let servedURL = try XCTUnwrap(URL(string: servedURLString))

        // Sanity: file is servable before removal.
        let (beforeResponse, _) = try await makeRequest(url: servedURL)
        XCTAssertEqual(beforeResponse.statusCode, 200)

        let fileId = String(servedURL.lastPathComponent.dropFirst("file-".count))
        frameworkServer.removeServedFile(fileId: fileId)

        // Give the barrier-queued removal a moment to land before re-requesting.
        try await Task.sleep(nanoseconds: 100_000_000)

        let (afterResponse, _) = try await makeRequest(url: servedURL)
        XCTAssertEqual(afterResponse.statusCode, 404)
    }
}
