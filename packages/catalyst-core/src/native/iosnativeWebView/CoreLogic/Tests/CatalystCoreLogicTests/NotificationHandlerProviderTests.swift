import XCTest
@testable import CatalystCoreLogic

/// A minimal, test-local stub used only to prove NotificationHandlerProvider
/// actually stores and returns whatever is injected — distinct from
/// NullNotificationHandler so identity comparison is meaningful.
private final class StubNotificationHandler: NotificationHandlerProtocol {
    func requestPermission() async -> Bool { true }
    func getPermissionStatusString() async -> String { "GRANTED" }
    func scheduleLocal(_ config: NotificationConfig) -> String { "stub-id" }
    func cancelLocal(_ notificationId: String) -> Bool { true }
    func cancelAllLocal() {}
    func initializePush() async -> (token: String?, error: String?) { ("stub-token", nil) }
    func subscribeToTopic(_ topic: String) async -> Bool { true }
    func unsubscribeFromTopic(_ topic: String) async -> Bool { true }
    func getSubscribedTopics() async -> [String] { ["stub-topic"] }
    func updateBadge(_ count: Int) {}
    func setNavigationHandler(_ handler: @escaping (URL) -> Void) {}
}

/**
 * Unit tests for NotificationHandlerProvider
 *
 * Covers the default (NullNotificationHandler) value and inject() replacing
 * it — the two lines of real logic in this 3-line file.
 */
final class NotificationHandlerProviderTests: XCTestCase {

    override func tearDown() {
        // Restore the default so other tests / files aren't affected by
        // this file's injection (NotificationHandlerProvider.shared is
        // process-global mutable state).
        NotificationHandlerProvider.shared = NullNotificationHandler.shared
        super.tearDown()
    }

    func testDefaultShared_IsNullNotificationHandler() {
        NotificationHandlerProvider.shared = NullNotificationHandler.shared
        XCTAssertTrue(NotificationHandlerProvider.shared as AnyObject === NullNotificationHandler.shared)
    }

    func testInject_ReplacesSharedHandler() {
        let stub = StubNotificationHandler()

        NotificationHandlerProvider.inject(stub)

        XCTAssertTrue(NotificationHandlerProvider.shared as AnyObject === stub)
        XCTAssertFalse(NotificationHandlerProvider.shared as AnyObject === NullNotificationHandler.shared)
    }

    func testInject_InjectedHandlerBehavesAsProvided() async {
        let stub = StubNotificationHandler()
        NotificationHandlerProvider.inject(stub)

        let granted = await NotificationHandlerProvider.shared.requestPermission()

        XCTAssertTrue(granted)
    }
}
