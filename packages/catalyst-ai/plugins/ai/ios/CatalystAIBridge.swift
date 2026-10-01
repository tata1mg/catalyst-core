//
//  CatalystAIBridge.swift
//  catalyst-ai (iOS)
//
//  Kotlin equivalent: CatalystAIBridge.kt. Picks the engine, prepares it off the main thread, wires
//  the stream supplier into the framework server, then reports ready with the stream URL.
//

import Foundation
import CatalystCoreLogic

final class CatalystAIBridge: AIBridge {
    static let shared = CatalystAIBridge()

    private let lock = NSLock()
    private var callbacks: AIBridgeCallbacks?
    private var engines: [EngineKind: NativeAIEngine] = [:]
    private var activeEngine: NativeAIEngine?
    private var isInitializing = false

    func attach(callbacks: AIBridgeCallbacks) {
        lock.lock(); defer { lock.unlock() }
        self.callbacks = callbacks
    }

    func initAI(optionsRaw: String?) {
        let (cb, alreadyRunning): (AIBridgeCallbacks?, Bool) = lock.withLock {
            let alreadyRunning = isInitializing
            if callbacks != nil && !alreadyRunning { isInitializing = true }
            return (callbacks, alreadyRunning)
        }

        guard let cb = cb, !alreadyRunning else { return } // duplicate call: ignored, like Android's AlreadyRunning

        Task.detached(priority: .userInitiated) { [self] in
            await run(optionsRaw: optionsRaw, callbacks: cb)
            lock.withLock { isInitializing = false }
        }
    }

    func clearConversation() {
        let engine = lock.withLock { activeEngine }
        engine?.clearConversation()
    }

    // MARK: - Private

    private func run(optionsRaw: String?, callbacks cb: AIBridgeCallbacks) async {
        guard cb.ensureFrameworkServerRunning() else {
            cb.onError("FrameworkServer not running — cannot expose AI stream", code: NativeAIErrorCode.requestFailed)
            return
        }

        let options = AIOptions(optionsRaw: optionsRaw)
        let log: AILogHandler = { cb.onLog($0) }

        let choice = EngineSelection.choose(
            requested: options.engine,
            liteRTModelCached: NativeBridgeAI.cachedModelPath(for: options) != nil,
            foundationModelsAvailable: FoundationModelsSupport.isAvailable
        )
        let kind: EngineKind
        switch choice {
        case .success(let selected): kind = selected
        case .failure(let error):
            cb.onError("Failed to load native AI model: \(error.message)", code: error.code)
            return
        }
        log("Native AI engine: \(kind.rawValue)")

        guard let engine = engine(for: kind) else {
            cb.onError("Failed to load native AI model: engine \(kind.rawValue) is not supported on this OS", code: NativeAIErrorCode.requestFailed)
            return
        }

        do {
            try await engine.prepare(options: options)
        } catch {
            let code = (error as? NativeAIError)?.code ?? NativeAIErrorCode.requestFailed
            cb.onError("Failed to load native AI model: \(error.localizedDescription)", code: code)
            return
        }

        lock.withLock { activeEngine = engine }
        cb.setNativeAiSupplier { prompt, genConfig, conversationId in
            try await engine.supply(prompt: prompt, genConfig: genConfig, conversationId: conversationId)
        }
        cb.setNativeSystemPrompt(engine.serverSystemPrompt)

        guard let streamUrl = cb.getNativeAIStreamURL() else {
            cb.onError("FrameworkServer stopped before the AI stream was ready", code: NativeAIErrorCode.streamNotReady)
            return
        }
        cb.onReady(streamUrl: streamUrl, port: cb.getFrameworkServerPort(), sessionId: cb.getFrameworkServerSessionId(), engine: kind.rawValue)
    }

    /// Engines are kept warm per kind so a second initAI reuses a loaded model. Their log/progress sinks
    /// resolve the *current* callbacks on every call: after a WebView reload initAI re-attaches new
    /// callbacks, and a warm engine must not keep reporting to the old (dead) WebView.
    private func engine(for kind: EngineKind) -> NativeAIEngine? {
        lock.lock(); defer { lock.unlock() }
        if let existing = engines[kind] { return existing }

        let log: AILogHandler = { [weak self] message in self?.currentCallbacks()?.onLog(message) }
        let progress: AIProgressHandler = { [weak self] phase, percent, loaded, total, detail in
            self?.currentCallbacks()?.onProgress(phase: phase, percent: percent, bytesLoaded: loaded, bytesTotal: total, detail: detail)
        }
        let created: NativeAIEngine?
        switch kind {
        case .liteRT: created = NativeBridgeAI(onLog: log, onProgress: progress)
        case .foundationModels: created = FoundationModelsSupport.makeEngine(onLog: log, onProgress: progress)
        }
        if let created = created { engines[kind] = created }
        return created
    }

    private func currentCallbacks() -> AIBridgeCallbacks? {
        lock.lock(); defer { lock.unlock() }
        return callbacks
    }
}
