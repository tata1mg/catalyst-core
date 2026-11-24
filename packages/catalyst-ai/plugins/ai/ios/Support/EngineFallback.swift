//
//  EngineFallback.swift
//  catalyst-ai (iOS)
//
//  LiteRT-LM is the preferred engine. When it cannot serve a request (the model fails to load, the engine
//  errors before the first token) the page would otherwise see an error on a device whose system model could
//  still answer, so Apple Foundation Models takes over. Pure so the policy is unit-tested without a model.
//

import Foundation
import CatalystCoreLogic

enum EngineFallback {
    /// Fall back only when it is safe and honest to:
    ///  - the engine was chosen by `auto` (an explicit `litert` request must fail as asked);
    ///  - LiteRT-LM is what failed;
    ///  - Foundation Models is available on this device (it needs no download, so falling back is free);
    ///  - it failed before the first token (text already streamed to the page cannot be taken back);
    ///  - the failure is not a malformed request, which the other engine would reject too.
    static func shouldFallBack(
        requested: EngineChoice,
        failed: EngineKind,
        error: Error,
        producedOutput: Bool,
        foundationModelsAvailable: Bool
    ) -> Bool {
        guard requested == .auto, failed == .liteRT else { return false }
        guard !producedOutput, foundationModelsAvailable else { return false }
        if error is CancellationError { return false }
        return (error as? NativeAIError)?.code != NativeAIErrorCode.invalidRequestBody
    }
}

/// The page holds one conversation id for the whole chat. After a fallback the engine behind it changes, and
/// its own ids differ, so this keeps the id the page was given stable and remembers the id each engine knows.
struct FallbackConversation {
    private(set) var exposedId: String?
    private(set) var innerId: String?

    /// The id to hand the engine for a request that arrived carrying `incoming`.
    func innerId(forIncoming incoming: String?) -> String? {
        guard let incoming, incoming == exposedId else { return nil }
        return innerId
    }

    /// Records the id the engine returned for a request that arrived carrying `incoming`; returns the id for the page.
    mutating func record(incoming: String?, returned: String) -> String {
        if let incoming, incoming == exposedId, let exposedId {
            innerId = returned
            return exposedId
        }
        exposedId = returned
        innerId = returned
        return returned
    }

    /// The engine behind the conversation changed; the page keeps its id.
    mutating func rebind(innerId newId: String) {
        innerId = newId
    }

    mutating func reset() {
        exposedId = nil
        innerId = nil
    }
}
