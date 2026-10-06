//
//  FoundationModelsAI.swift
//  catalyst-ai (iOS)
//
//  Apple's on-device system model (iOS 26+, Apple Intelligence devices). No download, but a small
//  context window (~4096 tokens shared by instructions, history and reply), so the system prompt is
//  given once as session `instructions` — never prepended per request like the LiteRT path, where it
//  would pile up in the transcript and exhaust the window within a few turns.
//

import Foundation
import CatalystCoreLogic

/// Availability-safe facade: the rest of the module (deployment target iOS 17) calls this, never the
/// iOS 26 types directly.
enum FoundationModelsSupport {
    static var isAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) { return FoundationModelsAI.isAvailable }
        #endif
        return false
    }

    static func makeEngine(onLog: @escaping AILogHandler, onProgress: @escaping AIProgressHandler) -> NativeAIEngine? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) { return FoundationModelsAI(onLog: onLog, onProgress: onProgress) }
        #endif
        return nil
    }
}

#if canImport(FoundationModels)
// The app's deployment target is iOS 17 but FoundationModels is iOS 26+. Every use below sits inside
// `#available(iOS 26.0, *)`, so the toolchain links the framework weakly (LC_LOAD_WEAK_DYLIB, verified in a
// linked iOS 17 simulator binary) and iOS 17-25 launches normally with the framework absent. Keep all
// FoundationModels references inside this availability-gated class, or the link becomes strong and dyld
// will refuse to launch the app on those versions.
import FoundationModels

@available(iOS 26.0, macOS 26.0, *)
final class FoundationModelsAI: NativeAIEngine {
    let kind: EngineKind = .foundationModels
    let serverSystemPrompt = ""

    private let onLog: AILogHandler
    private let onProgress: AIProgressHandler
    private let lock = NSLock()
    private var instructions = ""
    private var session: LanguageModelSession?
    private var conversationId: String?

    static var isAvailable: Bool { SystemLanguageModel.default.isAvailable }

    /// Human-readable reason the system model cannot be used right now.
    static var unavailableReason: String {
        switch SystemLanguageModel.default.availability {
        case .available:
            return ""
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible: return "This device does not support Apple Intelligence"
            case .appleIntelligenceNotEnabled: return "Apple Intelligence is turned off in Settings"
            case .modelNotReady: return "Apple's on-device model is still downloading — try again shortly"
            @unknown default: return "Apple's on-device model is unavailable"
            }
        @unknown default:
            return "Apple's on-device model is unavailable"
        }
    }

    init(onLog: @escaping AILogHandler, onProgress: @escaping AIProgressHandler) {
        self.onLog = onLog
        self.onProgress = onProgress
    }

    func prepare(options: AIOptions) async throws {
        guard Self.isAvailable else {
            throw NativeAIError(message: Self.unavailableReason)
        }
        let prompt = AIPromptBuilder.build(options, log: onLog)
        lock.withLock { instructions = prompt; session = nil; conversationId = nil }

        onLog("Foundation Models ready (no download needed)")
        onProgress("engine_init", 100, 0, 0, "ready")
    }

    func clearConversation() {
        lock.withLock { session = nil; conversationId = nil }
        onLog("Native conversation cleared — next call starts a fresh session")
    }

    func supply(prompt: String, genConfig: [String: Any], conversationId incomingId: String?) async throws -> NativeAIStream {
        let (activeSession, activeId) = currentSession(reusing: incomingId)
        if activeSession.isResponding {
            throw NativeAIError(message: "The on-device model is still answering the previous message")
        }

        // genConfig is ignored, matching Android's ConversationConfig() defaults.
        let responses = activeSession.streamResponse(to: prompt)

        let tokens = AsyncThrowingStream<String, Error> { continuation in
            let task = Task {
                var delta = StreamDelta()
                do {
                    // Each snapshot is the text so far; the SSE `token` frame must carry only the new part.
                    for try await snapshot in responses {
                        let piece = delta.next(snapshot.content)
                        if !piece.isEmpty { continuation.yield(piece) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.map(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        return (activeId, tokens)
    }

    // MARK: - Private

    private func currentSession(reusing incomingId: String?) -> (LanguageModelSession, String) {
        lock.lock(); defer { lock.unlock() }
        if let incomingId = incomingId, incomingId == conversationId, let session = session {
            onLog("Native session: reusing conversation \(incomingId)")
            return (session, incomingId)
        }
        onLog("Native session: creating new conversation")
        let created = LanguageModelSession(instructions: instructions.isEmpty ? nil : instructions)
        let id = UUID().uuidString
        session = created
        conversationId = id
        return (created, id)
    }

    private static func map(_ error: Error) -> Error {
        if error is CancellationError { return error }
        if let friendly = FoundationModelsErrors.friendlyMessage(forDescription: String(describing: error)) {
            return NativeAIError(message: friendly)
        }
        return NativeAIError(message: error.localizedDescription)
    }
}
#endif
