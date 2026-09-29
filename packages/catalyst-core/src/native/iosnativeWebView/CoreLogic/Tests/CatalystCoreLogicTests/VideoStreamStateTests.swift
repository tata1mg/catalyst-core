import XCTest
@testable import CatalystCoreLogic

/**
 * Unit tests for VideoStreamState
 *
 * Exhaustive truth-table coverage of the state transition rules documented
 * directly in VideoStreamState.swift:
 *
 *   IDLE      → STARTING  (start() called)
 *   STARTING  → STREAMING (session running)
 *   STARTING  → IDLE      (permission denied or bind failure)
 *   STREAMING → HOLD      (QR detected)
 *   HOLD      → STREAMING (hold expired)
 *   STREAMING → FLIPPING  (flip() called)
 *   FLIPPING  → STREAMING (rebind complete)
 *   STREAMING → STOPPING  (stop() called)
 *   FLIPPING  → STOPPING  (stop() called mid-flip)
 *   HOLD      → STOPPING  (stop() called during hold)
 *   STOPPING  → IDLE      (session torn down)
 *
 * Every other (from, to) pair among the 6 states must be rejected.
 */
final class VideoStreamStateTests: XCTestCase {

    private static let allStates: [VideoStreamState] = [
        .idle, .starting, .streaming, .hold, .flipping, .stopping,
    ]

    /// The exact set of valid transitions, mirroring the doc comment above.
    private static let validTransitions: Set<[String]> = [
        ["idle", "starting"],
        ["starting", "streaming"],
        ["starting", "idle"],
        ["streaming", "hold"],
        ["hold", "streaming"],
        ["streaming", "flipping"],
        ["flipping", "streaming"],
        ["streaming", "stopping"],
        ["flipping", "stopping"],
        ["hold", "stopping"],
        ["stopping", "idle"],
    ]

    private func name(_ state: VideoStreamState) -> String {
        switch state {
        case .idle: return "idle"
        case .starting: return "starting"
        case .streaming: return "streaming"
        case .hold: return "hold"
        case .flipping: return "flipping"
        case .stopping: return "stopping"
        }
    }

    func testCanTransitionTo_ExhaustiveTruthTable() {
        for from in Self.allStates {
            for to in Self.allStates {
                let expected = Self.validTransitions.contains([name(from), name(to)])
                let actual = from.canTransitionTo(to)
                XCTAssertEqual(
                    actual, expected,
                    "canTransitionTo mismatch: \(name(from)) -> \(name(to)), expected \(expected), got \(actual)"
                )
            }
        }
    }

    func testIsActive_StreamingHoldFlippingAreActive() {
        XCTAssertTrue(VideoStreamState.streaming.isActive)
        XCTAssertTrue(VideoStreamState.hold.isActive)
        XCTAssertTrue(VideoStreamState.flipping.isActive)
    }

    func testIsActive_IdleStartingStoppingAreNotActive() {
        XCTAssertFalse(VideoStreamState.idle.isActive)
        XCTAssertFalse(VideoStreamState.starting.isActive)
        XCTAssertFalse(VideoStreamState.stopping.isActive)
    }

    func testIsActive_AllStatesCoveredExactlyOnce() {
        // Sanity check that the two tests above between them cover every
        // case in the enum — guards against silently missing a case if the
        // enum ever grows.
        let activeCount = Self.allStates.filter { $0.isActive }.count
        let inactiveCount = Self.allStates.filter { !$0.isActive }.count
        XCTAssertEqual(activeCount, 3)
        XCTAssertEqual(inactiveCount, 3)
        XCTAssertEqual(activeCount + inactiveCount, Self.allStates.count)
    }
}
