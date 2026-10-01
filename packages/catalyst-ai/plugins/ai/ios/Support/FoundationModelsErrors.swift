//
//  FoundationModelsErrors.swift
//  catalyst-ai (iOS)
//
//  Maps Foundation Models failures to messages the app can show. Matches on the error's description
//  rather than its enum cases because Apple moved/deprecated these cases between iOS 26 and 27
//  (GenerationError.exceededContextWindowSize -> LanguageModelError.contextSizeExceeded); a string
//  match covers both without a deprecation-gated switch.
//

import Foundation

enum FoundationModelsErrors {
    static let contextWindowMessage =
        "This conversation is too long for Apple's on-device model (about 4,000 tokens). Clear the conversation and try again."
    static let guardrailMessage =
        "Apple's on-device model declined this request because of its safety guardrails."

    /// `description` is String(describing: error).
    static func friendlyMessage(forDescription description: String) -> String? {
        let text = description.lowercased()
        if text.contains("context") && (text.contains("exceed") || text.contains("size")) {
            return contextWindowMessage
        }
        if text.contains("guardrail") {
            return guardrailMessage
        }
        return nil
    }
}
