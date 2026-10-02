import XCTest
import Foundation
import Network
@testable import CatalystCoreLogic

/**
 * Deterministic tests for FrameworkServerUtils' connection error paths.
 *
 * Whether Network.framework reports a dropped client as a `.failed` connection
 * state, a receive error, or a send error is timing-dependent, so driving them
 * with real sockets made the CoreLogic line-coverage number vary from run to
 * run and turned the coverage-regression gate into a coin flip. These tests
 * call the extracted handlers directly with synthetic errors so every branch
 * runs every time.
 */
final class FrameworkServerUtilsConnectionHandlerTests: XCTestCase {

    private var frameworkServer: FrameworkServerUtils!

    /// A connection to a closed loopback port (discard, 9). It never carries data;
    /// it only needs to be startable so that cancel() is observable as `.cancelled`.
    private func makeIdleConnection() -> NWConnection {
        NWConnection(host: "127.0.0.1", port: 9, using: .tcp)
    }

    /// Starts a connection, runs `action` on it, and asserts it ends up `.cancelled`.
    private func assertCancelled(
        by action: (NWConnection) -> Void,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let connection = makeIdleConnection()
        let cancelled = expectation(description: "connection cancelled")
        connection.stateUpdateHandler = { state in
            if case .cancelled = state { cancelled.fulfill() }
        }
        connection.start(queue: .global(qos: .utility))

        action(connection)

        wait(for: [cancelled], timeout: 5)
    }

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

    func testConnectionStateFailed_CancelsConnection() {
        assertCancelled { connection in
            frameworkServer.handleConnectionStateChange(.failed(.posix(.ECONNRESET)), on: connection)
        }
    }

    func testConnectionStateCancelled_DoesNotThrowForUntrackedConnection() {
        let connection = makeIdleConnection()

        frameworkServer.handleConnectionStateChange(.cancelled, on: connection)

        XCTAssertEqual(frameworkServer.activeConnectionCount(), 0)
    }

    func testConnectionStateWaiting_IsIgnored() {
        let connection = makeIdleConnection()

        frameworkServer.handleConnectionStateChange(.waiting(.posix(.ENETDOWN)), on: connection)

        XCTAssertNotEqual(connection.state, .cancelled)
        connection.cancel()
    }

    func testReceiveError_CancelsConnection() {
        assertCancelled { connection in
            frameworkServer.handleReceiveError(.posix(.ECONNRESET), on: connection)
        }
    }

    func testReceivedData_WithError_CancelsConnection() {
        assertCancelled { connection in
            frameworkServer.handleReceivedData(nil, isComplete: false, error: .posix(.ECONNRESET), on: connection)
        }
    }

    func testSendCompletion_WithError_CancelsConnection() {
        assertCancelled { connection in
            frameworkServer.handleSendCompletion(.posix(.EPIPE), on: connection)
        }
    }

    func testSendCompletion_WithoutError_CancelsConnection() {
        assertCancelled { connection in
            frameworkServer.handleSendCompletion(nil, on: connection)
        }
    }

    // MARK: - Port selection

    /// findAvailablePort() must skip a port that is already bound. Which ports
    /// are busy on a CI runner is environmental, so the skip path only ran
    /// sometimes; occupying the first port in the range makes it run every time.
    func testStartServer_SkipsOccupiedPort() throws {
        let firstPort = FrameworkServerUtils.FRAMEWORK_PORT_RANGE_START

        let blocker = socket(AF_INET, SOCK_STREAM, 0)
        try XCTSkipIf(blocker == -1, "could not create blocker socket")
        defer { close(blocker) }

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = firstPort.bigEndian
        addr.sin_addr.s_addr = INADDR_ANY
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(blocker, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        // bind() failing means another process already holds the first port,
        // which exercises the same skip path, so the assertions below still hold.
        _ = bound

        XCTAssertTrue(frameworkServer.startServer())
        XCTAssertNotEqual(frameworkServer.getServerPort(), firstPort)
        XCTAssertGreaterThan(frameworkServer.getServerPort(), firstPort)
    }
}
