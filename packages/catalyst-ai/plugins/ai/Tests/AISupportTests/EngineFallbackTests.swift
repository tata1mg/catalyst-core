import XCTest
import CatalystCoreLogic
@testable import AISupport

final class EngineFallbackTests: XCTestCase {
    private struct Opaque: Error {}

    private func decide(
        requested: EngineChoice = .auto,
        failed: EngineKind = .liteRT,
        error: Error = Opaque(),
        produced: Bool = false,
        fmAvailable: Bool = true
    ) -> Bool {
        EngineFallback.shouldFallBack(requested: requested, failed: failed, error: error,
                                      producedOutput: produced, foundationModelsAvailable: fmAvailable)
    }

    func testFallsBackToFoundationModelsWhenLiteRTFailsBeforeAnyOutput() {
        XCTAssertTrue(decide())
    }

    func testNeverFallsBackWhenLiteRTWasAskedForExplicitly() {
        XCTAssertFalse(decide(requested: .liteRT))
        XCTAssertFalse(decide(requested: .foundationModels))
    }

    func testFoundationModelsIsTheLastResort() {
        XCTAssertFalse(decide(failed: .foundationModels))
    }

    func testNeverFallsBackOnceTextHasBeenStreamed() {
        XCTAssertFalse(decide(produced: true))
    }

    func testNeedsTheSystemModelToBeAvailable() {
        XCTAssertFalse(decide(fmAvailable: false))
    }

    func testCancellationIsNotAFailure() {
        XCTAssertFalse(decide(error: CancellationError()))
    }

    func testAMalformedRequestIsReportedNotRetried() {
        XCTAssertFalse(decide(error: NativeAIError(message: "bad", code: NativeAIErrorCode.invalidRequestBody)))
        XCTAssertTrue(decide(error: NativeAIError(message: "engine failed", code: NativeAIErrorCode.requestFailed)))
    }
}

final class FallbackConversationTests: XCTestCase {
    func testFirstRequestExposesTheEnginesId() {
        var convo = FallbackConversation()
        XCTAssertNil(convo.innerId(forIncoming: nil))
        XCTAssertEqual(convo.record(incoming: nil, returned: "fm-1"), "fm-1")
        XCTAssertEqual(convo.innerId(forIncoming: "fm-1"), "fm-1")
    }

    func testThePageKeepsItsIdAfterTheEngineBehindItChanges() {
        var convo = FallbackConversation()
        _ = convo.record(incoming: nil, returned: "fm-1")
        convo.rebind(innerId: "lite-9")
        XCTAssertEqual(convo.innerId(forIncoming: "fm-1"), "lite-9", "next turn continues the LiteRT conversation")
        XCTAssertEqual(convo.record(incoming: "fm-1", returned: "lite-9"), "fm-1", "the page is never handed a new id")
    }

    func testAnUnknownIdStartsAFreshConversation() {
        var convo = FallbackConversation()
        _ = convo.record(incoming: nil, returned: "fm-1")
        XCTAssertNil(convo.innerId(forIncoming: "stale"))
        XCTAssertEqual(convo.record(incoming: "stale", returned: "fm-2"), "fm-2")
    }

    func testResetForgetsTheConversation() {
        var convo = FallbackConversation()
        _ = convo.record(incoming: nil, returned: "fm-1")
        convo.reset()
        XCTAssertNil(convo.innerId(forIncoming: "fm-1"))
    }
}
