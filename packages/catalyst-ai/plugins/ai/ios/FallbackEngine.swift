//
//  FallbackEngine.swift
//  catalyst-ai (iOS)
//
//  Serves requests with LiteRT-LM and, if it fails to load or fails before producing any text, answers with
//  Apple Foundation Models instead (see EngineFallback). Once it has fallen back it stays on the fallback
//  until the next initAI, so a device where LiteRT-LM keeps failing pays for one failed attempt, not one per
//  message.
//

import Foundation
import CatalystCoreLogic

final class FallbackEngine: NativeAIEngine {
    /// The engine that is answering right now: the primary until it has fallen back, then the fallback.
    var kind: EngineKind { lock.withLock { fallback?.kind ?? primary.kind } }

    /// What the framework server prepends to every prompt. Fixed when prepare() returns, because the bridge reads
    /// it once, right after, and the server keeps applying that value even if a later request falls back.
    private(set) var serverSystemPrompt = ""

    private let primary: NativeAIEngine
    private let requested: EngineChoice
    private let fallbackAvailable: () -> Bool
    private let makeFallback: () -> NativeAIEngine?
    private let onLog: AILogHandler
    private let lock = NSLock()
    private var options: AIOptions?
    private var fallback: NativeAIEngine?
    private var conversation = FallbackConversation()

    init(
        primary: NativeAIEngine,
        requested: EngineChoice,
        fallbackAvailable: @escaping () -> Bool,
        makeFallback: @escaping () -> NativeAIEngine?,
        onLog: @escaping AILogHandler
    ) {
        self.primary = primary
        self.requested = requested
        self.fallbackAvailable = fallbackAvailable
        self.makeFallback = makeFallback
        self.onLog = onLog
    }

    func prepare(options: AIOptions) async throws {
        lock.withLock { self.options = options; fallback = nil; conversation.reset() }
        do {
            try await primary.prepare(options: options)
            lock.withLock { serverSystemPrompt = primary.serverSystemPrompt }
        } catch {
            guard allowsFallback(for: error, produced: false), let engine = try await activateFallback(after: error) else {
                throw error
            }
            lock.withLock { serverSystemPrompt = engine.serverSystemPrompt }
        }
    }

    func clearConversation() {
        let active = lock.withLock { () -> NativeAIEngine in
            conversation.reset()
            return fallback ?? primary
        }
        active.clearConversation()
    }

    func supply(prompt: String, genConfig: [String: Any], conversationId incomingId: String?) async throws -> NativeAIStream {
        let (active, innerId) = lock.withLock { (fallback, conversation.innerId(forIncoming: incomingId)) }
        if let active {
            let inner = try await active.supply(prompt: adapt(prompt, for: active), genConfig: genConfig, conversationId: innerId)
            let exposedId = lock.withLock { conversation.record(incoming: incomingId, returned: inner.conversationId) }
            return (exposedId, inner.tokens)
        }

        let inner = try await primary.supply(prompt: prompt, genConfig: genConfig, conversationId: innerId)
        let exposedId = lock.withLock { conversation.record(incoming: incomingId, returned: inner.conversationId) }

        let tokens = AsyncThrowingStream<String, Error> { continuation in
            let task = Task {
                var produced = false
                do {
                    for try await token in inner.tokens {
                        produced = true
                        continuation.yield(token)
                    }
                    continuation.finish()
                } catch {
                    await self.recover(from: error, produced: produced, prompt: prompt, genConfig: genConfig, into: continuation)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        return (exposedId, tokens)
    }

    // MARK: - Private

    private func allowsFallback(for error: Error, produced: Bool) -> Bool {
        EngineFallback.shouldFallBack(
            requested: requested, failed: primary.kind, error: error,
            producedOutput: produced, foundationModelsAvailable: fallbackAvailable()
        )
    }

    /// Prepares the fallback engine and makes it the active one. Nil if there is nothing to fall back to.
    private func activateFallback(after error: Error) async throws -> NativeAIEngine? {
        guard let options = lock.withLock({ self.options }), let engine = makeFallback() else { return nil }
        onLog("\(primary.kind.rawValue) failed (\(error.localizedDescription)); using \(engine.kind.rawValue) instead")
        do {
            try await engine.prepare(options: options)
        } catch {
            throw NativeAIError(message: "\(primary.kind.rawValue) failed and so did \(engine.kind.rawValue): \(error.localizedDescription)")
        }
        lock.withLock { fallback = engine; conversation.reset() }
        return engine
    }

    private func recover(
        from error: Error,
        produced: Bool,
        prompt: String,
        genConfig: [String: Any],
        into continuation: AsyncThrowingStream<String, Error>.Continuation
    ) async {
        guard allowsFallback(for: error, produced: produced) else {
            continuation.finish(throwing: error)
            return
        }
        do {
            guard let engine = try await activateFallback(after: error) else {
                continuation.finish(throwing: error)
                return
            }
            let inner = try await engine.supply(prompt: adapt(prompt, for: engine), genConfig: genConfig, conversationId: nil)
            lock.withLock { conversation.rebind(innerId: inner.conversationId) }
            for try await token in inner.tokens { continuation.yield(token) }
            continuation.finish()
        } catch {
            continuation.finish(throwing: error)
        }
    }

    /// The server prepends `serverSystemPrompt` to every prompt before it reaches this engine. Whatever engine
    /// answers gets the prompt without that prefix, plus its own if it expects the server to supply one.
    private func adapt(_ prompt: String, for engine: NativeAIEngine) -> String {
        let applied = lock.withLock { serverSystemPrompt }
        var bare = prompt
        if !applied.isEmpty, prompt.hasPrefix("\(applied)\n\n") { bare = String(prompt.dropFirst(applied.count + 2)) }
        let own = engine.serverSystemPrompt
        if own == applied { return prompt }
        return own.isEmpty ? bare : "\(own)\n\n\(bare)"
    }
}
