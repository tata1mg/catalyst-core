import XCTest
import Foundation
@testable import CatalystCoreLogic

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
 * Same "server may not start in this sandbox" guard as the existing test
 * file — network restrictions in some CI/sandbox environments can prevent
 * NWListener from binding. Tests skip (not fail) in that case, consistent
 * with the established pattern.
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

        if frameworkServer.isRunning() {
            frameworkServer.stopServer()
        }
        frameworkServer = nil
        super.tearDown()
    }

    /// Starts the server and waits for NWListener's async stateUpdateHandler
    /// to settle, mirroring the pattern already established in
    /// FrameworkServerUtilsTests.swift. Returns false (and the caller should
    /// skip) if the server isn't actually running afterward.
    private func startServerAndWaitReady() -> Bool {
        let started = frameworkServer.startServer()
        guard started else { return false }
        Thread.sleep(forTimeInterval: 0.3)
        return frameworkServer.isRunning()
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

    // MARK: - Status endpoint

    func testStatusEndpoint_ReturnsRunningJSON() async throws {
        guard startServerAndWaitReady() else {
            throw XCTSkip("Server failed to start in this environment — skipping loopback test")
        }

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
        guard startServerAndWaitReady() else {
            throw XCTSkip("Server failed to start in this environment — skipping loopback test")
        }

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
        guard startServerAndWaitReady() else {
            throw XCTSkip("Server failed to start in this environment — skipping loopback test")
        }

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
        guard startServerAndWaitReady() else {
            throw XCTSkip("Server failed to start in this environment — skipping loopback test")
        }

        let port = frameworkServer.getServerPort()
        let sessionId = frameworkServer.getSessionId()
        let url = try XCTUnwrap(URL(string: "http://localhost:\(port)/framework-\(sessionId)/file-does-not-exist"))

        let (response, _) = try await makeRequest(url: url)

        XCTAssertEqual(response.statusCode, 404)
    }

    func testInvalidRoute_Returns404() async throws {
        guard startServerAndWaitReady() else {
            throw XCTSkip("Server failed to start in this environment — skipping loopback test")
        }

        let port = frameworkServer.getServerPort()
        let url = try XCTUnwrap(URL(string: "http://localhost:\(port)/not-a-real-route"))

        let (response, _) = try await makeRequest(url: url)

        XCTAssertEqual(response.statusCode, 404)
    }

    func testNonGETMethod_Returns405() async throws {
        guard startServerAndWaitReady() else {
            throw XCTSkip("Server failed to start in this environment — skipping loopback test")
        }

        let port = frameworkServer.getServerPort()
        let sessionId = frameworkServer.getSessionId()
        let url = try XCTUnwrap(URL(string: "http://localhost:\(port)/framework-\(sessionId)/status"))

        let (response, _) = try await makeRequest(url: url, method: "POST")

        XCTAssertEqual(response.statusCode, 405)
    }

    // MARK: - removeServedFile

    func testRemoveServedFile_SubsequentRequestReturns404() async throws {
        guard startServerAndWaitReady() else {
            throw XCTSkip("Server failed to start in this environment — skipping loopback test")
        }

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
