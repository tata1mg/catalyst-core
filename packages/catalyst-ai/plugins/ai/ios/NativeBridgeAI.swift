//
//  NativeBridgeAI.swift
//  catalyst-ai (iOS)
//
//  Kotlin equivalent: NativeBridgeAI.kt. All LiteRT-LM logic lives here so catalyst-core has no
//  LiteRT imports. Downloads the model (same registry as Android) on first use, then keeps one warm
//  Engine and one active Conversation.
//

import Foundation
import CatalystCoreLogic
import LiteRTLM

final class NativeBridgeAI: NativeAIEngine {
    private struct ModelEntry {
        let url: String
        let filename: String
        let sizeHint: Int64
    }

    /// Same models as Android's MODEL_REGISTRY.
    private static let modelRegistry: [String: ModelEntry] = [
        "gemma-4-E2B": ModelEntry(
            url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm",
            filename: "gemma-4-E2B-it.litertlm",
            sizeHint: 2_588_147_712
        ),
        "qwen3-0.6B": ModelEntry(
            url: "https://huggingface.co/litert-community/Qwen3-0.6B-it-litert-lm/resolve/main/Qwen3-0.6B-it-int4.litertlm",
            filename: "Qwen3-0.6B-it-int4.litertlm",
            sizeHint: 474_000_000
        ),
    ]

    let kind: EngineKind = .liteRT
    private(set) var serverSystemPrompt = ""

    private let onLog: AILogHandler
    private let onProgress: AIProgressHandler
    private let lock = NSLock()
    private var engine: Engine?
    private var loadedModelPath: String?
    private var conversation: Conversation?
    private var conversationId: String?

    init(onLog: @escaping AILogHandler, onProgress: @escaping AIProgressHandler) {
        self.onLog = onLog
        self.onProgress = onProgress
    }

    // MARK: - Model location

    /// Application Support (not Caches, which iOS may purge under storage pressure), excluded from backup.
    private static func modelsDirectory() throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var directory = base.appendingPathComponent("catalyst-ai", isDirectory: true).appendingPathComponent("models", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? directory.setResourceValues(values)
        return directory
    }

    /// Path of an already-present model for these options, or nil. Used to decide the engine without downloading.
    static func cachedModelPath(for options: AIOptions) -> String? {
        if let explicit = options.modelPath {
            return FileManager.default.fileExists(atPath: explicit) ? explicit : nil
        }
        guard let entry = modelRegistry[options.modelKey],
              let directory = try? modelsDirectory() else { return nil }
        let file = directory.appendingPathComponent(entry.filename)
        let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int64) ?? 0
        return size > 0 ? file.path : nil
    }

    // MARK: - NativeAIEngine

    func prepare(options: AIOptions) async throws {
        serverSystemPrompt = AIPromptBuilder.build(options, log: onLog)
        let modelPath = try await resolveModel(options)
        try await ensureEngine(modelPath: modelPath)
    }

    func clearConversation() {
        lock.withLock { conversation = nil; conversationId = nil }
        onLog("Native conversation cleared — next call starts a fresh session")
    }

    func supply(prompt: String, genConfig: [String: Any], conversationId incomingId: String?) async throws -> NativeAIStream {
        let loaded = lock.withLock { engine }
        guard let loaded = loaded else {
            throw NativeAIError(message: "Engine not initialized — call init() first", code: NativeAIErrorCode.streamNotReady)
        }

        let (active, activeId) = try await currentConversation(on: loaded, reusing: incomingId)

        // genConfig is ignored, matching Android's ConversationConfig() defaults.
        let updates = active.sendMessageStream(Message(prompt))

        let tokens = AsyncThrowingStream<String, Error> { continuation in
            let task = Task {
                do {
                    // sendMessageStream yields deltas (LiteRT-LM's own tests build the reply with
                    // `accumulated += chunk.toString`), which is already what an SSE `token` frame carries.
                    for try await message in updates {
                        let piece = message.toString
                        if !piece.isEmpty { continuation.yield(piece) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { reason in
                if case .cancelled = reason {
                    try? active.cancel() // client went away: stop decoding
                }
                task.cancel()
            }
        }
        return (activeId, tokens)
    }

    // MARK: - Private

    private func currentConversation(on loaded: Engine, reusing incomingId: String?) async throws -> (Conversation, String) {
        let reusable: Conversation? = lock.withLock {
            if let incomingId = incomingId, incomingId == conversationId { return conversation }
            return nil
        }
        if let existing = reusable, let incomingId = incomingId {
            onLog("Native session: reusing conversation \(incomingId)")
            return (existing, incomingId)
        }

        onLog("Native session: creating new conversation")
        let created = try await loaded.createConversation(with: ConversationConfig())
        let id = UUID().uuidString
        lock.withLock { conversation = created; conversationId = id }
        return (created, id)
    }

    private func resolveModel(_ options: AIOptions) async throws -> String {
        if let explicit = options.modelPath {
            onLog("Using explicit modelPath: \(explicit)")
            return explicit
        }
        guard let entry = Self.modelRegistry[options.modelKey] else {
            throw NativeAIError(message: "Unknown model '\(options.modelKey)'. Available: \(Self.modelRegistry.keys.sorted().joined(separator: ", "))")
        }
        onLog("Model registry lookup: \(options.modelKey)")
        onProgress("lookup", 0, 0, 0, options.modelKey)
        return try await downloadModel(entry, policy: options.downloadPolicy)
    }

    private func ensureEngine(modelPath: String) async throws {
        // A warm engine is only reusable for the model it was built from; a different model or path replaces it
        // (and drops the conversation, which belongs to the old engine).
        let reusable = lock.withLock { engine != nil && loadedModelPath == modelPath }
        if reusable {
            onLog("Engine already loaded — reusing warm instance")
            return
        }
        lock.withLock {
            if engine != nil { onLog("Model changed — replacing the loaded engine") }
            engine = nil
            loadedModelPath = nil
            conversation = nil
            conversationId = nil
        }
        onProgress("engine_init", 0, 0, 0, "loading")
        let created = try await tryCreateEngine(modelPath: modelPath)
        lock.withLock { engine = created; loadedModelPath = modelPath }
        onLog("LiteRT-LM engine ready")
        onProgress("engine_init", 100, 0, 0, "ready")
    }

    /// GPU (Metal) first, CPU as the fallback — same order as Android's tryCreateEngine.
    private func tryCreateEngine(modelPath: String) async throws -> Engine {
        let cacheDir = (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("catalyst-ai", isDirectory: true).path) ?? NSTemporaryDirectory()
        try? FileManager.default.createDirectory(atPath: cacheDir, withIntermediateDirectories: true)

        onLog("[tryCreateEngine] modelPath=\(modelPath)")
        onLog("[tryCreateEngine] Attempting Backend.gpu...")
        do {
            let created = Engine(engineConfig: try EngineConfig(modelPath: modelPath, backend: .gpu, cacheDir: cacheDir))
            try await created.initialize()
            onLog("[tryCreateEngine] GPU engine initialized successfully")
            return created
        } catch {
            onLog("[tryCreateEngine] GPU failed: \(error.localizedDescription)")
            onLog("[tryCreateEngine] Falling back to Backend.cpu...")
            do {
                let created = Engine(engineConfig: try EngineConfig(modelPath: modelPath, backend: .cpu(), cacheDir: cacheDir))
                try await created.initialize()
                onLog("[tryCreateEngine] CPU engine initialized successfully")
                return created
            } catch {
                onLog("[tryCreateEngine] CPU also failed: \(error.localizedDescription)")
                throw error
            }
        }
    }

    private func downloadModel(_ entry: ModelEntry, policy: DownloadPolicy) async throws -> String {
        let directory = try Self.modelsDirectory()
        let modelFile = directory.appendingPathComponent(entry.filename)

        if let size = (try? FileManager.default.attributesOfItem(atPath: modelFile.path)[.size] as? Int64), size > 0 {
            onLog("Model cache hit: \(entry.filename) (\(size / 1_000_000)MB)")
            onProgress("cache", 100, size, size, "cached")
            return modelFile.path
        }

        onLog("Downloading model: \(entry.filename) from HuggingFace (~\(entry.sizeHint / 1_000_000)MB)")
        onProgress("download", 0, 0, entry.sizeHint, "starting")

        // The partial and its ETag stay on disk across failures and launches so the next attempt resumes.
        let partial = directory.appendingPathComponent("\(entry.filename).tmp")

        var throttle = ProgressThrottle()
        let known = KnownTotal(entry.sizeHint)
        let downloader = ModelDownloader(partial: partial, policy: policy, gate: .shared, onLog: onLog) { [onLog, onProgress] loaded, total in
            let total = total > 0 ? total : entry.sizeHint
            known.value = total
            let percent = Int(min(100, loaded * 100 / max(total, 1)))
            guard throttle.shouldEmit(percent: percent) else { return }
            let detail = "\(loaded / 1_000_000)MB / \(total / 1_000_000)MB"
            onProgress("download", percent, loaded, total, detail)
            onLog("Download: \(percent)% (\(detail))")
        }
        func partialSize() -> Int64 {
            ((try? FileManager.default.attributesOfItem(atPath: partial.path)[.size]) as? Int64) ?? 0
        }
        // Weak link, dropped connection or a pause from the page: wait, then resume from the partial.
        let resilient = ResilientDownload(policy: policy, gate: .shared, partialSize: partialSize, onLog: onLog) { [onProgress] status in
            let loaded = partialSize()
            let total = known.value
            let percent = Int(min(100, loaded * 100 / max(total, 1)))
            switch status {
            case .paused(let reason, let retry):
                let detail = retry.map { "\(reason.rawValue), retrying in \($0)s" } ?? reason.rawValue
                onProgress("paused", percent, loaded, total, detail)
            case .resuming:
                onProgress("download", percent, loaded, total, "resuming")
            }
        }

        guard let url = URL(string: entry.url) else {
            throw NativeAIError(message: "Model download failed: invalid URL")
        }
        do {
            let size = try await resilient.run { try await downloader.download(from: url) }
            try? FileManager.default.removeItem(at: modelFile)
            try FileManager.default.moveItem(at: partial, to: modelFile)
            try? FileManager.default.removeItem(at: partial.appendingPathExtension("etag"))
            onLog("Download complete: \(size / 1_000_000)MB saved to \(modelFile.path)")
            onProgress("download", 100, size, size, "complete")
        } catch {
            if (error as? ModelDownloadError)?.discardPartial == true { downloader.discardPartial() }
            throw NativeAIError(message: "Model download failed: \(error.localizedDescription)")
        }
        return modelFile.path
    }
}

/// The total the server announced, shared with the status callback of an in-flight download.
private final class KnownTotal {
    var value: Int64
    init(_ value: Int64) { self.value = value }
}
