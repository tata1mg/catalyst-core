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
        convo.rebind(innerId: "lite-9", ifGeneration: convo.generation)
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

    func testAFallbackKeepsTheIdThePageHoldsAndMovesOnlyTheEngineBehindIt() {
        var conversation = FallbackConversation()
        let exposed = conversation.record(incoming: nil, returned: "litert-1")
        XCTAssertEqual(exposed, "litert-1")
        // the stream failed before its first token and the fallback took over: rebind, never reset
        conversation.rebind(innerId: "fm-9", ifGeneration: conversation.generation)
        XCTAssertEqual(conversation.exposedId, "litert-1")
        XCTAssertEqual(conversation.innerId(forIncoming: "litert-1"), "fm-9", "the next turn carrying the page's id continues the mapped session")
        XCTAssertEqual(conversation.record(incoming: "litert-1", returned: "fm-9"), "litert-1")
    }

    func testResettingForgetsTheIdSoItIsOnlyForPreparing() {
        var conversation = FallbackConversation()
        _ = conversation.record(incoming: nil, returned: "litert-1")
        conversation.reset()
        XCTAssertNil(conversation.innerId(forIncoming: "litert-1"))
    }

    func testAFailedFallbackRequestLeavesNoStaleEngineIdBehind() {
        var conversation = FallbackConversation()
        _ = conversation.record(incoming: nil, returned: "litert-1")
        // the fallback took over but its first request failed: the page keeps its id, the dead engine's id must not be handed on
        conversation.forgetInner(ifStill: "litert-1")
        XCTAssertEqual(conversation.exposedId, "litert-1")
        XCTAssertNil(conversation.innerId(forIncoming: "litert-1"), "the next request starts a fresh inner conversation")
        XCTAssertEqual(conversation.record(incoming: "litert-1", returned: "fm-2"), "litert-1", "and the page still sees one stable id")
        XCTAssertEqual(conversation.innerId(forIncoming: "litert-1"), "fm-2")
    }

    func testForgettingLeavesANewerRequestsIdAlone() {
        var conversation = FallbackConversation()
        _ = conversation.record(incoming: nil, returned: "litert-1")
        // another request already bound the fallback's id while this one was failing
        conversation.rebind(innerId: "fm-5", ifGeneration: conversation.generation)
        conversation.forgetInner(ifStill: "litert-1")
        XCTAssertEqual(conversation.innerId(forIncoming: "litert-1"), "fm-5")
    }
}

final class FallbackConversationRaceTests: XCTestCase {
    func testARecoveryThatBeganBeforeAClearCannotRebindTheNewConversation() {
        var convo = FallbackConversation()
        _ = convo.record(incoming: nil, returned: "lite-1")
        let recoveryStartedAt = convo.generation // a recovery for the first conversation begins
        convo.reset() // clearConversation(): the page starts over
        _ = convo.record(incoming: nil, returned: "lite-2") // the new conversation
        convo.rebind(innerId: "fm-1", ifGeneration: recoveryStartedAt) // the stale recovery finishes
        XCTAssertEqual(convo.innerId, "lite-2", "the new conversation keeps its own id")
    }

    func testARecoveryInTheSameGenerationStillRebinds() {
        var convo = FallbackConversation()
        _ = convo.record(incoming: nil, returned: "lite-1")
        convo.rebind(innerId: "fm-1", ifGeneration: convo.generation)
        XCTAssertEqual(convo.innerId, "fm-1")
    }

    func testForgettingTheInnerIdKeepsThePagesIdAndStartsFreshBehindIt() {
        var convo = FallbackConversation()
        let exposed = convo.record(incoming: nil, returned: "lite-1")
        convo.forgetInner(ifStill: convo.innerId)
        XCTAssertNil(convo.innerId(forIncoming: exposed), "the next request for the page's id gets no engine id")
        XCTAssertEqual(convo.exposedId, exposed)
    }

    func testForgettingDoesNotRemoveAnIdAnotherRequestBoundMeanwhile() {
        var convo = FallbackConversation()
        _ = convo.record(incoming: nil, returned: "lite-1")
        convo.rebind(innerId: "fm-2", ifGeneration: convo.generation)
        convo.forgetInner(ifStill: "lite-1")
        XCTAssertEqual(convo.innerId, "fm-2")
    }
}

