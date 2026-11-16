//
//  AIOptions.swift
//  catalyst-ai (iOS)
//
//  Parses the options JSON JS passes to initAI. Kotlin equivalent: the JSONObject handling at the
//  top of NativeBridgeAI.init() — same keys (modelPath, model, attachmentComponents, systemPrompt),
//  plus `engine` to pin one engine instead of the automatic choice.
//

import Foundation

enum EngineChoice: String {
    case auto
    case liteRT = "litert"
    case foundationModels = "foundation-models"
}

struct AIOptions {
    static let defaultModelKey = "gemma-4-E2B"

    let engine: EngineChoice
    let modelPath: String?
    let modelKey: String
    let systemPrompt: String
    let attachmentComponents: [String: Any]

    /// Malformed or missing JSON yields defaults, like Kotlin's `try { JSONObject(...) } catch { JSONObject() }`.
    init(optionsRaw: String?) {
        let object = optionsRaw
            .flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]

        engine = (object["engine"] as? String).flatMap(EngineChoice.init(rawValue:)) ?? .auto
        let explicitPath = (object["modelPath"] as? String) ?? ""
        modelPath = explicitPath.isEmpty ? nil : explicitPath
        modelKey = (object["model"] as? String) ?? Self.defaultModelKey
        systemPrompt = ((object["systemPrompt"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        attachmentComponents = object["attachmentComponents"] as? [String: Any] ?? [:]
    }
}
