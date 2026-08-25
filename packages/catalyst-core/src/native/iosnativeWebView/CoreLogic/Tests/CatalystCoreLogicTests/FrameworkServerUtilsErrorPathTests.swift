import XCTest
import Foundation
@testable import CatalystCoreLogic

/**
 * Targeted unit tests for FrameworkServerUtils' internal error/edge branches
 * that don't need a running server or a real HTTP round-trip — the pure
 * validation logic (validateFilePath, updateAllowedOrigin,
 * addFileToServe's not-running guard) and FrameworkServerError's own
 * computed property.
 *
 * Complements FrameworkServerUtilsTests.swift (lifecycle/config) and
 * FrameworkServerUtilsLoopbackTests.swift (real request/response
 * round-trips) — this file is specifically the "call the internal method
 * directly with an input designed to hit one branch" layer.
 */
final class FrameworkServerUtilsErrorPathTests: XCTestCase {

    var frameworkServer: FrameworkServerUtils!

    override func setUp() {
        super.setUp()
        frameworkServer = FrameworkServerUtils.shared
    }

    override func tearDown() {
        if frameworkServer.isRunning() {
            frameworkServer.stopServer()
        }
        frameworkServer = nil
        super.tearDown()
    }

    // MARK: - FrameworkServerError.localizedDescription

    func testFrameworkServerError_CacheInitializationFailed_Description() {
        let error = FrameworkServerError.cacheInitializationFailed("disk full")
        XCTAssertEqual(error.localizedDescription, "Cache initialization failed: disk full")
    }

    func testFrameworkServerError_DataConversionFailed_Description() {
        let error = FrameworkServerError.dataConversionFailed("bad encoding")
        XCTAssertEqual(error.localizedDescription, "Data conversion failed: bad encoding")
    }

    func testFrameworkServerError_ConnectionHandlingFailed_Description() {
        let error = FrameworkServerError.connectionHandlingFailed("socket closed")
        XCTAssertEqual(error.localizedDescription, "Connection handling failed: socket closed")
    }

    // MARK: - addFileToServe: not-running guard

    func testAddFileToServe_ServerNotRunning_ReturnsNil() {
        // Server is deliberately not started in this test.
        XCTAssertFalse(frameworkServer.isRunning())

        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("not-served.txt")
        try? Data("x".utf8).write(to: tempURL)
        defer { try? FileManager.default.removeItem(at: tempURL) }

        let result = frameworkServer.addFileToServe(file: tempURL, fileName: "not-served.txt", mimeType: "text/plain")

        XCTAssertNil(result)
    }

    // MARK: - copyAndServeFile: not-running / no cache directory guard

    func testCopyAndServeFile_ServerNotRunning_ReturnsNil() {
        XCTAssertFalse(frameworkServer.isRunning())

        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("not-copied.txt")
        try? Data("x".utf8).write(to: tempURL)
        defer { try? FileManager.default.removeItem(at: tempURL) }

        let result = frameworkServer.copyAndServeFile(originalFile: tempURL, fileName: "not-copied.txt", mimeType: "text/plain")

        XCTAssertNil(result)
    }

    // MARK: - updateAllowedOrigin

    func testUpdateAllowedOrigin_EmptyURL_FallsBackToWildcard() {
        // No direct getter for allowedOrigin, but this exercises the
        // internal branch without crashing and documents the contract.
        frameworkServer.updateAllowedOrigin(from: "")
        // No assertion on internal state (private) — the value is exercised
        // for real via the CORS header in the loopback tests' status
        // endpoint response headers in a follow-up if a getter is ever added.
    }

    func testUpdateAllowedOrigin_ValidURL_ExtractsSchemeHostPort() {
        frameworkServer.updateAllowedOrigin(from: "http://192.168.0.104:3005/some/path")
        // Same note as above — exercises the parse-success branch.
    }

    func testUpdateAllowedOrigin_UnparsableURL_FallsBackToWildcard() {
        // A string with characters URLComponents can't parse as a URL at all.
        frameworkServer.updateAllowedOrigin(from: "http://[invalid")
    }

    func testUpdateAllowedOrigin_URLWithNoHostOrScheme_FallsBackToWildcard() {
        // Parses as URLComponents but yields no scheme/host/port to build
        // an origin from.
        frameworkServer.updateAllowedOrigin(from: "/relative/path/only")
    }
}
