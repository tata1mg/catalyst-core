import XCTest
import CatalystCoreLogic
@testable import AISupport

final class AIOptionsTests: XCTestCase {
    func testDefaults_WhenNilOrMalformed() {
        for raw in [nil, "", "not json", "[1,2]"] as [String?] {
            let options = AIOptions(optionsRaw: raw)
            XCTAssertEqual(options.engine, .auto)
            XCTAssertEqual(options.modelKey, "gemma-4-E2B")
            XCTAssertNil(options.modelPath)
            XCTAssertTrue(options.attachmentComponents.isEmpty)
        }
    }

    func testParsesKeys() {
        let options = AIOptions(optionsRaw: #"{"engine":"foundation-models","model":"qwen3-0.6B","modelPath":"/x/y.litertlm","systemPrompt":"  hi  ","attachmentComponents":{"Card":{"hint":"a card"}}}"#)
        XCTAssertEqual(options.engine, .foundationModels)
        XCTAssertEqual(options.modelKey, "qwen3-0.6B")
        XCTAssertEqual(options.modelPath, "/x/y.litertlm")
        XCTAssertEqual(options.systemPrompt, "hi")
        XCTAssertEqual(options.attachmentComponents.count, 1)
    }

    func testUnknownEngine_FallsBackToAuto() {
        XCTAssertEqual(AIOptions(optionsRaw: #"{"engine":"gpt"}"#).engine, .auto)
    }
}

final class AIPromptBuilderTests: XCTestCase {
    func testEmptyComponents_BuildsNothing_LikeAndroid() {
        let options = AIOptions(optionsRaw: #"{"systemPrompt":"be nice"}"#)
        XCTAssertEqual(AIPromptBuilder.build(options), "")
    }

    func testBuildsAppPromptInstructionAndSortedComponentSummary() {
        let options = AIOptions(optionsRaw: #"{"systemPrompt":"Be brief.","attachmentComponents":{"Chart":{"hint":"numbers"},"Card":{}}}"#)
        let prompt = AIPromptBuilder.build(options)
        let lines = prompt.components(separatedBy: "\n")
        XCTAssertEqual(lines[0], "Be brief.")
        XCTAssertEqual(lines[1], "")
        XCTAssertTrue(lines[2].hasPrefix("Never use markdown headers"))
        XCTAssertEqual(lines[3], "Available components: Card, Chart (numbers)")
    }

    func testNoAppPrompt_StartsWithInstruction() {
        let options = AIOptions(optionsRaw: #"{"attachmentComponents":{"Card":{}}}"#)
        XCTAssertTrue(AIPromptBuilder.build(options).hasPrefix("Never use markdown headers"))
    }
}

final class EngineSelectionTests: XCTestCase {
    private func choose(_ requested: EngineChoice, cached: Bool, fm: Bool) -> EngineKind? {
        if case .success(let kind) = EngineSelection.choose(requested: requested, liteRTModelCached: cached, foundationModelsAvailable: fm) { return kind }
        return nil
    }

    func testAuto_PrefersCachedLiteRT() {
        XCTAssertEqual(choose(.auto, cached: true, fm: true), .liteRT)
    }

    func testAuto_UsesFoundationModelsWhenNoModelOnDisk() {
        XCTAssertEqual(choose(.auto, cached: false, fm: true), .foundationModels)
    }

    func testAuto_FallsBackToLiteRTDownloadWhenNothingElse() {
        XCTAssertEqual(choose(.auto, cached: false, fm: false), .liteRT)
    }

    func testPinnedLiteRT_IgnoresFoundationModels() {
        XCTAssertEqual(choose(.liteRT, cached: false, fm: true), .liteRT)
    }

    func testPinnedFoundationModels_FailsWhenUnavailable() {
        guard case .failure(let error) = EngineSelection.choose(requested: .foundationModels, liteRTModelCached: true, foundationModelsAvailable: false) else {
            return XCTFail("expected failure")
        }
        XCTAssertEqual(error.code, NativeAIErrorCode.requestFailed)
    }
}

final class StreamDeltaTests: XCTestCase {
    func testCumulativeSnapshots_YieldOnlyNewSuffix() {
        var delta = StreamDelta()
        XCTAssertEqual(delta.next("Hel"), "Hel")
        XCTAssertEqual(delta.next("Hello"), "lo")
        XCTAssertEqual(delta.next("Hello"), "")
        XCTAssertEqual(delta.next("Hello world"), " world")
    }

    func testRepeatedCharactersAreNotDropped() {
        var delta = StreamDelta()
        let out = ["\n", "\n\n", "\n\n\n"].map { delta.next($0) }.joined()
        XCTAssertEqual(out, "\n\n\n")
    }

    func testRewrittenText_EmitsOnlyDivergentTail() {
        var delta = StreamDelta()
        _ = delta.next("The cat")
        XCTAssertEqual(delta.next("The dog sat"), "dog sat")
    }

    func testUnicodeAndEmoji() {
        var delta = StreamDelta()
        XCTAssertEqual(delta.next("héllo 👨‍👩‍👧"), "héllo 👨‍👩‍👧")
        XCTAssertEqual(delta.next("héllo 👨‍👩‍👧 ✓"), " ✓")
    }
}

final class ProgressThrottleTests: XCTestCase {
    func testEmitsOnPercentChange_AndAfterInterval_NotOtherwise() {
        var throttle = ProgressThrottle(minInterval: 0.2)
        let t0 = Date()
        XCTAssertTrue(throttle.shouldEmit(percent: 0, now: t0))
        XCTAssertFalse(throttle.shouldEmit(percent: 0, now: t0.addingTimeInterval(0.05)))
        XCTAssertTrue(throttle.shouldEmit(percent: 1, now: t0.addingTimeInterval(0.06)))
        XCTAssertTrue(throttle.shouldEmit(percent: 1, now: t0.addingTimeInterval(0.30)))
    }
}

final class FoundationModelsErrorsTests: XCTestCase {
    func testContextWindowDescriptions_Ios26And27() {
        XCTAssertEqual(FoundationModelsErrors.friendlyMessage(forDescription: "exceededContextWindowSize(Context(debugDescription: \"x\"))"), FoundationModelsErrors.contextWindowMessage)
        XCTAssertEqual(FoundationModelsErrors.friendlyMessage(forDescription: "contextSizeExceeded(...)"), FoundationModelsErrors.contextWindowMessage)
    }

    func testGuardrail() {
        XCTAssertEqual(FoundationModelsErrors.friendlyMessage(forDescription: "guardrailViolation(...)"), FoundationModelsErrors.guardrailMessage)
    }

    func testUnrelatedError_IsNotRemapped() {
        XCTAssertNil(FoundationModelsErrors.friendlyMessage(forDescription: "rateLimited"))
    }
}
