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
    /// The fallback being prepared right now; later failures join it instead of preparing the same engine again.
    private var activation: Task<NativeAIEngine, Error>?
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
        lock.withLock { self.options = options; fallback = nil; activation = nil; conversation.reset() }
        do {
            try await primary.prepare(options: options)
            lock.withLock { serverSystemPrompt = primary.serverSystemPrompt }
        } catch {
            guard allowsFallback(for: error, produced: false), let engine = try await activateFallback(after: error, resetConversation: true) else {
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
        let (active, innerId, generation) = lock.withLock { (fallback, conversation.innerId(forIncoming: incomingId), conversation.generation) }
        if let active {
            let inner = try await active.supply(prompt: adapt(prompt, for: active), genConfig: genConfig, conversationId: innerId)
            let exposedId = lock.withLock { conversation.record(incoming: incomingId, returned: inner.conversationId) }
            return (exposedId, inner.tokens)
        }

        let inner: NativeAIStream
        do {
            inner = try await primary.supply(prompt: prompt, genConfig: genConfig, conversationId: innerId)
        } catch {
            // LiteRT can fail while setting the request up (creating the conversation), before any stream exists. That is still
            // a failure before the first token, so it falls back like one that happens later; anything else is rethrown as is.
            // Setting the request up can fail before the bridge has validated its media, so check it here: a malformed inputParts must be
            // rejected as an invalid request, not answered by the fallback as if it were text only.
            do { _ = try AIInputParts.parse(genConfig) } catch {
                throw NativeAIError(message: error.localizedDescription, code: NativeAIErrorCode.invalidRequestBody)
            }
            guard allowsFallback(for: error, produced: false),
                  let engine = try await activateFallback(after: error, resetConversation: false) else { throw error }
            // The binding this request used on the failed engine: sampling the map after activation could pick up a newer request's valid one.
            let stale = innerId
            let recovered: NativeAIStream
            do {
                recovered = try await engine.supply(prompt: adapt(prompt, for: engine), genConfig: genConfig, conversationId: nil)
            } catch {
                // The fallback is now the active engine, but the id the map holds is still the failed engine's. Forget it, so the next
                // request starts a fresh conversation instead of handing the fallback an id it has never seen.
                lock.withLock { conversation.forgetInner(ifStill: stale) }
                throw error
            }
            // The page keeps the id it holds; only the engine behind it changes. If the conversation was cleared meanwhile, the answer still
            // goes back but the new conversation is left alone.
            let exposed = lock.withLock { generation == conversation.generation ? conversation.record(incoming: incomingId, returned: recovered.conversationId) : recovered.conversationId }
            return (exposed, recovered.tokens)
        }
        let exposedId = lock.withLock { conversation.record(incoming: incomingId, returned: inner.conversationId) }
        let primaryInnerId = inner.conversationId

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
                    await self.recover(from: error, produced: produced, prompt: prompt, genConfig: genConfig, generation: generation, failedInnerId: primaryInnerId, into: continuation)
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
    /// `resetConversation` is true only while preparing, when there is no conversation yet. When a live request falls back, the id
    /// the page was already given must survive: the caller rebinds just the engine behind it.
    private func activateFallback(after error: Error, resetConversation: Bool) async throws -> NativeAIEngine? {
        // Decided under one lock so concurrent failures share a single preparation instead of each preparing the same engine.
        enum Step { case ready(NativeAIEngine), join(Task<NativeAIEngine, Error>), start(Task<NativeAIEngine, Error>, NativeAIEngine), none }
        let step: Step = lock.withLock {
            if let fallback { return .ready(fallback) }
            if let activation { return .join(activation) }
            guard let options, let engine = makeFallback() else { return .none }
            let primaryName = primary.kind.rawValue
            let task = Task<NativeAIEngine, Error> {
                do {
                    try await engine.prepare(options: options)
                    // Publish before anyone waiting on this task resumes: the starter and every joiner return only after the fallback is
                    // active and the failed engine's binding is gone, so a joiner cannot bind its own conversation and have the starter
                    // wipe it afterwards.
                    self.lock.withLock {
                        self.fallback = engine
                        self.activation = nil
                        if resetConversation {
                            self.conversation.reset()
                        } else {
                            // The id in the map belongs to the failed engine: dropped in the same critical section that makes the fallback
                            // reachable, so a request for the same page id starts a fresh conversation instead of being handed an id the
                            // fallback never issued.
                            self.conversation.forgetInner(ifStill: self.conversation.innerId)
                        }
                    }
                    return engine
                } catch {
                    self.lock.withLock { self.activation = nil }
                    throw NativeAIError(message: "\(primaryName) failed and so did \(engine.kind.rawValue): \(error.localizedDescription)")
                }
            }
            activation = task
            return .start(task, engine)
        }
        switch step {
        case .none:
            return nil
        case .ready(let engine):
            return engine
        case .join(let task):
            return try await task.value
        case .start(let task, let engine):
            onLog("\(primary.kind.rawValue) failed (\(error.localizedDescription)); using \(engine.kind.rawValue) instead")
            return try await task.value
        }
    }

    private func recover(
        from error: Error,
        produced: Bool,
        prompt: String,
        genConfig: [String: Any],
        generation: Int,
        failedInnerId: String,
        into continuation: AsyncThrowingStream<String, Error>.Continuation
    ) async {
        guard allowsFallback(for: error, produced: produced) else {
            continuation.finish(throwing: error)
            return
        }
        do {
            guard let engine = try await activateFallback(after: error, resetConversation: false) else {
                continuation.finish(throwing: error)
                return
            }
            let stale: String? = failedInnerId
            let inner: NativeAIStream
            do {
                inner = try await engine.supply(prompt: adapt(prompt, for: engine), genConfig: genConfig, conversationId: nil)
            } catch {
                // The fallback could not set the request up: the id the map holds still belongs to the failed engine. Forget it, so the next
                // request starts a fresh conversation instead of handing the fallback an id it has never seen.
                lock.withLock { conversation.forgetInner(ifStill: stale) }
                throw error
            }
            lock.withLock { conversation.rebind(innerId: inner.conversationId, ifGeneration: generation) }
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
