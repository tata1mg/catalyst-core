//
//  EngineSelection.swift
//  catalyst-ai (iOS)
//
//  Which on-device engine serves a session. Pure so the policy is unit-tested without a model.
//

import Foundation
import CatalystCoreLogic

enum EngineKind: String {
    case liteRT = "litert"
    case foundationModels = "foundation-models"
}

enum EngineSelection {
    /// auto: use LiteRT-LM when its model is already on disk; otherwise Apple Foundation Models if the
    /// system model is available (no download); otherwise LiteRT-LM, which downloads the model first —
    /// Android's behaviour. A silent multi-GB download is never started just because Foundation Models
    /// happened to be available.
    static func choose(
        requested: EngineChoice,
        liteRTModelCached: Bool,
        foundationModelsAvailable: Bool
    ) -> Result<EngineKind, NativeAIError> {
        switch requested {
        case .liteRT:
            return .success(.liteRT)
        case .foundationModels:
            return foundationModelsAvailable
                ? .success(.foundationModels)
                : .failure(NativeAIError(message: "Apple Foundation Models is not available on this device", code: NativeAIErrorCode.requestFailed))
        case .auto:
            if liteRTModelCached { return .success(.liteRT) }
            return .success(foundationModelsAvailable ? .foundationModels : .liteRT)
        }
    }
}
