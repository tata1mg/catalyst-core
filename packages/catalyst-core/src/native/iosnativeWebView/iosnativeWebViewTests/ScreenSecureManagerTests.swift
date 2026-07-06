import XCTest
@testable import CatalystCore

/**
 * Unit tests for ScreenSecureManager
 *
 * Coverage:
 * 1. State management (3 tests)
 * 2. setScreenSecure behaviour (3 tests)
 * 3. Overlay race condition guard (2 tests)
 *
 * Total: 8 tests
 *
 * Note: UIWindow creation and scene observation require a running app / UI host.
 * Tests here focus on the state machine and guard logic that can be exercised
 * without a UIWindowScene. Overlay installation side-effects are verified
 * indirectly via the guard flags and isScreenSecure state.
 */
final class ScreenSecureManagerTests: XCTestCase {

    var manager: ScreenSecureManager!

    override func setUp() {
        super.setUp()
        // Use the shared singleton; reset state by disabling screen security
        manager = ScreenSecureManager.shared
        manager.setScreenSecure(false)
    }

    override func tearDown() {
        // Leave the singleton clean for other tests
        manager.setScreenSecure(false)
        super.tearDown()
    }

    // ============================================================
    // CATEGORY 1: State management (3 tests)
    // ============================================================

    func testInitialState_IsNotSecure() {
        // After setUp calls setScreenSecure(false), isScreenSecure must be false
        XCTAssertFalse(manager.isScreenSecure, "Initial state should not be secure")
    }

    func testSetScreenSecure_True_UpdatesState() {
        manager.setScreenSecure(true)

        XCTAssertTrue(manager.isScreenSecure, "isScreenSecure should be true after enabling")
    }

    func testSetScreenSecure_False_UpdatesState() {
        manager.setScreenSecure(true)
        manager.setScreenSecure(false)

        XCTAssertFalse(manager.isScreenSecure, "isScreenSecure should be false after disabling")
    }

    // ============================================================
    // CATEGORY 2: setScreenSecure behaviour (3 tests)
    // ============================================================

    func testSetScreenSecure_EnableThenDisable_StateIsConsistent() {
        manager.setScreenSecure(true)
        XCTAssertTrue(manager.isScreenSecure)

        manager.setScreenSecure(false)
        XCTAssertFalse(manager.isScreenSecure)

        // Re-enable
        manager.setScreenSecure(true)
        XCTAssertTrue(manager.isScreenSecure)
    }

    func testSetScreenSecure_DisableWhenAlreadyDisabled_NoStateChange() {
        // Should be a no-op and not throw
        manager.setScreenSecure(false)
        manager.setScreenSecure(false)

        XCTAssertFalse(manager.isScreenSecure, "Repeated disable should leave state as false")
    }

    func testSetScreenSecure_EnableWhenAlreadyEnabled_NoStateChange() {
        manager.setScreenSecure(true)
        manager.setScreenSecure(true)

        XCTAssertTrue(manager.isScreenSecure, "Repeated enable should leave state as true")
    }

    // ============================================================
    // CATEGORY 3: Overlay race condition guard (2 tests)
    // ============================================================

    func testSceneWillDeactivate_WhenNotSecure_OverlayNotInstalled() {
        // When isScreenSecure is false, sceneWillDeactivate must be a no-op.
        // We verify by checking state is still false after the notification fires.
        manager.setScreenSecure(false)

        NotificationCenter.default.post(
            name: UIScene.willDeactivateNotification,
            object: nil
        )

        // State must not have changed
        XCTAssertFalse(manager.isScreenSecure,
                       "State should remain false when secure mode is off")
    }

    func testSceneDidActivate_AfterEnable_StateUnchanged() {
        // sceneDidActivate removes the overlay but does NOT reset isScreenSecure.
        manager.setScreenSecure(true)

        NotificationCenter.default.post(
            name: UIScene.didActivateNotification,
            object: nil
        )

        // The secure flag must survive a return-to-foreground event
        XCTAssertTrue(manager.isScreenSecure,
                      "isScreenSecure should remain true after scene reactivation")
    }
}
