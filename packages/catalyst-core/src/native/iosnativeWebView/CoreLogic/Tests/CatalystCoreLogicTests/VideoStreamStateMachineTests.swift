import XCTest
@testable import CatalystCoreLogic

/// A test-local listener that records every callback it receives, and can
/// be used to exercise both the notification path and the weak-reference
/// compaction path (by letting it deallocate while still registered).
private final class RecordingListener: VideoStreamStateListener {
    struct Event: Equatable {
        let prev: String
        let next: String
    }

    private(set) var events: [Event] = []

    func onStateChanged(prev: VideoStreamState, next: VideoStreamState) {
        events.append(Event(prev: describe(prev), next: describe(next)))
    }

    private func describe(_ state: VideoStreamState) -> String {
        switch state {
        case .idle: return "idle"
        case .starting: return "starting"
        case .streaming: return "streaming"
        case .hold: return "hold"
        case .flipping: return "flipping"
        case .stopping: return "stopping"
        }
    }
}

/**
 * Unit tests for VideoStreamStateMachine
 *
 * Covers: initial state, valid/invalid transitions, isActive derivation,
 * listener add/remove/notify, and weak-listener compaction on dealloc.
 */
final class VideoStreamStateMachineTests: XCTestCase {

    func testInitialState_IsIdle() {
        let machine = VideoStreamStateMachine()
        XCTAssertEqual(machine.state, .idle)
        XCTAssertFalse(machine.isActive)
    }

    func testValidTransition_UpdatesStateAndReturnsTrue() {
        let machine = VideoStreamStateMachine()

        let result = machine.transition(to: .starting)

        XCTAssertTrue(result)
        XCTAssertEqual(machine.state, .starting)
    }

    func testInvalidTransition_LeavesStateUnchangedAndReturnsFalse() {
        let machine = VideoStreamStateMachine()

        // idle -> streaming is not a valid direct transition
        let result = machine.transition(to: .streaming)

        XCTAssertFalse(result)
        XCTAssertEqual(machine.state, .idle)
    }

    func testIsActive_TrueWhileStreamingHoldOrFlipping() {
        let machine = VideoStreamStateMachine()

        machine.transition(to: .starting)
        machine.transition(to: .streaming)
        XCTAssertTrue(machine.isActive)

        machine.transition(to: .hold)
        XCTAssertTrue(machine.isActive)

        machine.transition(to: .streaming)
        machine.transition(to: .flipping)
        XCTAssertTrue(machine.isActive)
    }

    func testIsActive_FalseOnceStopped() {
        let machine = VideoStreamStateMachine()

        machine.transition(to: .starting)
        machine.transition(to: .streaming)
        machine.transition(to: .stopping)
        XCTAssertFalse(machine.isActive)

        machine.transition(to: .idle)
        XCTAssertFalse(machine.isActive)
    }

    func testListener_ReceivesNotificationOnValidTransition() {
        let machine = VideoStreamStateMachine()
        let listener = RecordingListener()
        machine.addListener(listener)

        machine.transition(to: .starting)

        XCTAssertEqual(listener.events, [.init(prev: "idle", next: "starting")])
    }

    func testListener_DoesNotFireOnInvalidTransition() {
        let machine = VideoStreamStateMachine()
        let listener = RecordingListener()
        machine.addListener(listener)

        let result = machine.transition(to: .streaming) // idle -> streaming is invalid

        XCTAssertFalse(result)
        XCTAssertTrue(listener.events.isEmpty)
    }

    func testListener_ReceivesMultipleSequentialTransitions() {
        let machine = VideoStreamStateMachine()
        let listener = RecordingListener()
        machine.addListener(listener)

        machine.transition(to: .starting)
        machine.transition(to: .streaming)
        machine.transition(to: .stopping)
        machine.transition(to: .idle)

        XCTAssertEqual(listener.events, [
            .init(prev: "idle", next: "starting"),
            .init(prev: "starting", next: "streaming"),
            .init(prev: "streaming", next: "stopping"),
            .init(prev: "stopping", next: "idle"),
        ])
    }

    func testRemoveListener_StopsFurtherNotifications() {
        let machine = VideoStreamStateMachine()
        let listener = RecordingListener()
        machine.addListener(listener)

        machine.transition(to: .starting)
        machine.removeListener(listener)
        machine.transition(to: .streaming)

        XCTAssertEqual(listener.events, [.init(prev: "idle", next: "starting")])
    }

    func testWeakListener_DeallocatedListenerDoesNotCrashOnNextTransition() {
        let machine = VideoStreamStateMachine()

        // Register a listener that immediately goes out of scope; the
        // WeakListenerBox holding it should be compacted away on the next
        // transition rather than crash on a dangling reference.
        autoreleasepool {
            let shortLived = RecordingListener()
            machine.addListener(shortLived)
        }

        // Should not crash, and should still perform the transition normally.
        let result = machine.transition(to: .starting)
        XCTAssertTrue(result)
        XCTAssertEqual(machine.state, .starting)
    }

    func testMultipleListeners_AllReceiveNotification() {
        let machine = VideoStreamStateMachine()
        let listenerA = RecordingListener()
        let listenerB = RecordingListener()
        machine.addListener(listenerA)
        machine.addListener(listenerB)

        machine.transition(to: .starting)

        XCTAssertEqual(listenerA.events, [.init(prev: "idle", next: "starting")])
        XCTAssertEqual(listenerB.events, [.init(prev: "idle", next: "starting")])
    }
}
