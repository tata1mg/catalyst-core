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
            sizeHint: 1_870_000_000
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
        return try await downloadModel(entry)
    }

    private func ensureEngine(modelPath: String) async throws {
        let existing = lock.withLock { engine }
        if existing != nil {
            onLog("Engine already loaded — reusing warm instance")
            return
        }
        onProgress("engine_init", 0, 0, 0, "loading")
        let created = try await tryCreateEngine(modelPath: modelPath)
        lock.withLock { engine = created }
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

    private func downloadModel(_ entry: ModelEntry) async throws -> String {
        let directory = try Self.modelsDirectory()
        let modelFile = directory.appendingPathComponent(entry.filename)

        if let size = (try? FileManager.default.attributesOfItem(atPath: modelFile.path)[.size] as? Int64), size > 0 {
            onLog("Model cache hit: \(entry.filename) (\(size / 1_000_000)MB)")
            onProgress("cache", 100, size, size, "cached")
            return modelFile.path
        }

        onLog("Downloading model: \(entry.filename) from HuggingFace (~\(entry.sizeHint / 1_000_000)MB)")
        onProgress("download", 0, 0, entry.sizeHint, "starting")

        let partial = directory.appendingPathComponent("\(entry.filename).tmp")
        try? FileManager.default.removeItem(at: partial)

        var throttle = ProgressThrottle()
        let downloader = ModelDownloader(destination: partial) { [onLog, onProgress] loaded, total in
            let percent = total > 0 ? Int(loaded * 100 / total) : 0
            guard throttle.shouldEmit(percent: percent) else { return }
            let detail = "\(loaded / 1_000_000)MB / \(total / 1_000_000)MB"
            onProgress("download", percent, loaded, total, detail)
            onLog("Download: \(percent)% (\(detail))")
        }

        guard let url = URL(string: entry.url) else {
            throw NativeAIError(message: "Model download failed: invalid URL")
        }
        do {
            try await downloader.download(from: url)
            let size = (try? FileManager.default.attributesOfItem(atPath: partial.path)[.size] as? Int64) ?? 0
            if size == 0 { throw NativeAIError(message: "Downloaded file is empty") }
            try? FileManager.default.removeItem(at: modelFile)
            try FileManager.default.moveItem(at: partial, to: modelFile)
            onLog("Download complete: \(size / 1_000_000)MB saved to \(modelFile.path)")
            onProgress("download", 100, size, size, "complete")
        } catch {
            try? FileManager.default.removeItem(at: partial)
            throw NativeAIError(message: "Model download failed: \(error.localizedDescription)")
        }
        return modelFile.path
    }
}

/// URLSession download with progress. Downloading to disk (not iterating bytes) keeps a ~2GB model off the heap.
private final class ModelDownloader: NSObject, URLSessionDownloadDelegate {
    private let destination: URL
    private let onBytes: (_ loaded: Int64, _ total: Int64) -> Void
    private var continuation: CheckedContinuation<Void, Error>?
    private var session: URLSession?
    private var movedFile = false

    init(destination: URL, onBytes: @escaping (_ loaded: Int64, _ total: Int64) -> Void) {
        self.destination = destination
        self.onBytes = onBytes
    }

    func download(from url: URL) async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                self.continuation = continuation
                let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
                self.session = session
                session.downloadTask(with: url).resume()
            }
        } onCancel: {
            self.session?.invalidateAndCancel()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        onBytes(totalBytesWritten, totalBytesExpectedToWrite)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // `location` is deleted when this returns, so the move has to happen here.
        if let http = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            return // reported through didCompleteWithError below
        }
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
            movedFile = true
        } catch {
            movedFile = false
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer { session.finishTasksAndInvalidate(); continuation = nil }
        if let error = error {
            continuation?.resume(throwing: error)
        } else if let http = task.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            continuation?.resume(throwing: NativeAIError(message: "HTTP \(http.statusCode)"))
        } else if !movedFile {
            continuation?.resume(throwing: NativeAIError(message: "could not store the downloaded file"))
        } else {
            continuation?.resume()
        }
    }
}
