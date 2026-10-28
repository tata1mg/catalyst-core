//
//  ResumableDownload.swift
//  catalyst-ai (iOS)
//
//  Kotlin equivalent: ResumableDownloader.kt. Keep the two in step.
//
//  Resumable model download. A ~2.6 GB model that dies at 90% must not start over: the partial file and the
//  server's ETag stay on disk, and the next attempt asks for the rest with `Range` + `If-Range`. If the file changed
//  upstream, `If-Range` makes the server send the whole thing again and the partial is replaced, never spliced.
//

import Foundation

/// The decisions, kept free of I/O so they can be tested exhaustively.
enum ResumeRules {
    struct Resume: Equatable {
        let offset: Int64
        let etag: String
    }

    enum Outcome: Equatable {
        /// 206 at the offset we asked for: append, `total` is the full file size.
        case append(total: Int64)
        /// 200: the server sent the whole file (it ignored Range, or the file changed). Replace the partial.
        case truncate(total: Int64)
        /// 416 and the partial already is the whole file.
        case complete
        /// The partial cannot be continued (bad Content-Range, 416 on a different size): delete it and ask again.
        case restart
        case fail(status: Int)
    }

    /// Resume only with proof of which bytes the partial holds: some data and a strong ETag (If-Range ignores weak ones).
    static func plan(partialSize: Int64, storedETag: String?) -> Resume? {
        guard partialSize > 0, let etag = storedETag?.trimmingCharacters(in: .whitespaces),
              !etag.isEmpty, !etag.hasPrefix("W/") else { return nil }
        return Resume(offset: partialSize, etag: etag)
    }

    /// `bytes 100-499/500` -> (100, 499, 500); `bytes */500` -> (nil, nil, 500). Total is nil when the server sends `*`.
    static func parseContentRange(_ header: String?) -> (start: Int64?, end: Int64?, total: Int64?)? {
        guard let header = header?.trimmingCharacters(in: .whitespaces), header.lowercased().hasPrefix("bytes ") else { return nil }
        let spec = header.dropFirst("bytes ".count).split(separator: "/", omittingEmptySubsequences: false)
        guard spec.count == 2 else { return nil }
        let total = Int64(spec[1])
        if spec[0] == "*" { return (nil, nil, total) }
        let range = spec[0].split(separator: "-", omittingEmptySubsequences: false)
        guard range.count == 2, let start = Int64(range[0]), let end = Int64(range[1]), start <= end else { return nil }
        return (start, end, total)
    }

    /// `offset` is where we asked to resume (0 when we sent no Range).
    static func interpret(status: Int, offset: Int64, contentRange: String?, contentLength: Int64?) -> Outcome {
        let range = parseContentRange(contentRange)
        switch status {
        case 206:
            guard offset > 0, let range, range.start == offset, let total = range.total, total > offset else { return .restart }
            return .append(total: total)
        case 200:
            return .truncate(total: contentLength.flatMap { $0 > 0 ? $0 : nil } ?? -1)
        case 416:
            if offset > 0, let total = range?.total, total == offset { return .complete }
            return .restart
        default:
            return .fail(status: status)
        }
    }

    static func isStrong(etag: String?) -> Bool {
        guard let etag = etag?.trimmingCharacters(in: .whitespaces) else { return false }
        return !etag.isEmpty && !etag.hasPrefix("W/")
    }
}

struct ModelDownloadError: LocalizedError {
    let message: String
    /// True when keeping the partial cannot help (client error, corrupt size); false for network trouble and 5xx.
    let discardPartial: Bool
    /// True when trying again later can succeed (5xx, a connection that ended early); false for disk errors and the like.
    var transient: Bool = false
    var errorDescription: String? { message }
}

/// The transfer was stopped on purpose (the page paused it, or the link was too slow). The partial is kept.
struct DownloadInterrupted: Error, Equatable {
    enum Kind: Equatable {
        case paused(PauseReason)
        case weak(bytesPerSec: Double)
    }
    let kind: Kind
}

/// Streams to disk through a FileHandle, so a ~2 GB model never sits on the heap, and resumes a kept partial.
final class ModelDownloader: NSObject, URLSessionDataDelegate {
    private let partial: URL
    private let etagFile: URL
    private let configuration: URLSessionConfiguration
    private let policy: DownloadPolicy
    private let gate: DownloadGate?
    private let onBytes: (_ loaded: Int64, _ total: Int64) -> Void
    private let onLog: (String) -> Void

    // State of the attempt in flight (delegate callbacks arrive on one serial queue).
    private var continuation: CheckedContinuation<Void, Error>?
    private var session: URLSession?
    private var handle: FileHandle?
    private var offset: Int64 = 0
    private var written: Int64 = 0
    private var total: Int64 = -1
    private var restartNeeded = false
    private var alreadyComplete = false
    private var failure: Error?
    private var interruption: DownloadInterrupted.Kind?
    private var window: ThroughputWindow
    private var currentTask: URLSessionDataTask?

    /// The request timeout is the idle limit: no bytes for `windowSec` fails the transfer (a stalled link has no
    /// callbacks to measure, so this is what catches it). The resource limit bounds even a slow-but-moving one.
    static func defaultConfiguration(policy: DownloadPolicy = .default) -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = policy.windowSec
        configuration.timeoutIntervalForResource = 4 * 60 * 60
        return configuration
    }

    init(partial: URL, configuration: URLSessionConfiguration? = nil,
         policy: DownloadPolicy = .default, gate: DownloadGate? = nil,
         onLog: @escaping (String) -> Void = { _ in },
         onBytes: @escaping (_ loaded: Int64, _ total: Int64) -> Void) {
        self.partial = partial
        self.etagFile = partial.appendingPathExtension("etag")
        self.configuration = configuration ?? ModelDownloader.defaultConfiguration(policy: policy)
        self.policy = policy
        self.gate = gate
        self.window = ThroughputWindow(minBytesPerSec: policy.minBytesPerSec, windowSec: policy.windowSec)
        self.onLog = onLog
        self.onBytes = onBytes
    }

    /// Stop the transfer in flight and report why. The partial file and its ETag stay for the next attempt.
    func interrupt(_ kind: DownloadInterrupted.Kind) {
        if interruption == nil { interruption = kind }
        currentTask?.cancel()
    }

    /// Downloads into `partial` and returns its final size, verified against what the server announced.
    /// On failure the partial is kept for the next attempt unless it is known to be useless.
    func download(from url: URL) async throws -> Int64 {
        for attempt in 0..<2 {
            let resume = ResumeRules.plan(partialSize: fileSize(), storedETag: try? String(contentsOf: etagFile, encoding: .utf8))
            if resume == nil { discardPartial() }
            offset = resume?.offset ?? 0
            written = 0
            total = -1
            restartNeeded = false
            alreadyComplete = false
            failure = nil
            interruption = nil
            window = ThroughputWindow(minBytesPerSec: policy.minBytesPerSec, windowSec: policy.windowSec)
            // A pause that arrived between attempts is honoured before any bytes are requested.
            if let reason = gate?.pausedReason { throw DownloadInterrupted(kind: .paused(reason)) }
            if let resume { onLog("Resuming download at \(resume.offset / 1_000_000)MB") }

            try await withTaskCancellationHandler {
                try await runAttempt(url: url, resume: resume)
            } onCancel: {
                self.session?.invalidateAndCancel()
            }
            if restartNeeded && attempt == 0 {
                onLog("Partial download cannot be continued; starting over")
                discardPartial()
                continue
            }
            break
        }
        if restartNeeded { throw ModelDownloadError(message: "Server would not serve the model", discardPartial: true) }

        let size = fileSize()
        if size == 0 { throw ModelDownloadError(message: "Downloaded file is empty", discardPartial: true) }
        if total > 0 && size != total {
            // Short: the connection ended early, keep it and resume. Long: it can only be wrong.
            throw ModelDownloadError(message: "Download incomplete (\(size) of \(total) bytes)", discardPartial: size > total, transient: size < total)
        }
        return size
    }

    func discardPartial() {
        try? FileManager.default.removeItem(at: partial)
        try? FileManager.default.removeItem(at: etagFile)
    }

    private func fileSize() -> Int64 {
        ((try? FileManager.default.attributesOfItem(atPath: partial.path)[.size]) as? Int64) ?? 0
    }

    private func runAttempt(url: URL, resume: ResumeRules.Resume?) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.continuation = continuation
            var request = URLRequest(url: url)
            // Ranges address the bytes on the wire; never let a transfer encoding change what they mean.
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            if let resume {
                request.setValue("bytes=\(resume.offset)-", forHTTPHeaderField: "Range")
                request.setValue(resume.etag, forHTTPHeaderField: "If-Range")
            }
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            self.session = session
            let task = session.dataTask(with: request)
            self.currentTask = task
            // A pause from the page interrupts the transfer in flight instead of waiting for it to end.
            self.gate?.setPauseHandler { [weak self] reason in self?.interrupt(.paused(reason)) }
            task.resume()
        }
    }

    // MARK: URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            failure = ModelDownloadError(message: "Unexpected response", discardPartial: false)
            return completionHandler(.cancel)
        }
        let length = http.expectedContentLength > 0 ? http.expectedContentLength : nil
        switch ResumeRules.interpret(status: http.statusCode, offset: offset,
                                     contentRange: http.value(forHTTPHeaderField: "Content-Range"), contentLength: length) {
        case .append(let total):
            self.total = total
            guard openHandle(truncate: false) else { return completionHandler(.cancel) }
            saveETag(http.value(forHTTPHeaderField: "ETag"))
            completionHandler(.allow)
        case .truncate(let total):
            if offset > 0 { onLog("Server sent the whole file; replacing the partial") }
            offset = 0
            self.total = total
            guard openHandle(truncate: true) else { return completionHandler(.cancel) }
            saveETag(http.value(forHTTPHeaderField: "ETag"))
            completionHandler(.allow)
        case .complete:
            alreadyComplete = true
            completionHandler(.cancel)
        case .restart:
            restartNeeded = true
            completionHandler(.cancel)
        case .fail(let status):
            let client = (400..<500).contains(status)
            failure = ModelDownloadError(message: "HTTP \(status) from model server", discardPartial: client, transient: status >= 500 || status == 429)
            completionHandler(.cancel)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        do {
            try handle?.write(contentsOf: data)
            written += Int64(data.count)
            onBytes(offset + written, total)
            if case .weak(let rate) = window.record(bytes: Int64(data.count)) {
                interrupt(.weak(bytesPerSec: rate))
            }
        } catch {
            failure = ModelDownloadError(message: "Could not write the model: \(error.localizedDescription)", discardPartial: false)
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? handle?.close()
        handle = nil
        gate?.setPauseHandler(nil)
        currentTask = nil
        session.finishTasksAndInvalidate()
        let continuation = self.continuation
        self.continuation = nil
        // A deliberate cancel (.complete, .restart, a pause, a weak link, a recorded failure) is not a transport error.
        if let failure { continuation?.resume(throwing: failure) }
        else if let interruption { continuation?.resume(throwing: DownloadInterrupted(kind: interruption)) }
        else if restartNeeded || alreadyComplete { continuation?.resume() }
        else if let error { continuation?.resume(throwing: error) }
        else { continuation?.resume() }
    }

    private func openHandle(truncate: Bool) -> Bool {
        do {
            if truncate || !FileManager.default.fileExists(atPath: partial.path) {
                FileManager.default.createFile(atPath: partial.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: partial)
            if !truncate { try handle.seekToEnd() }
            self.handle = handle
            return true
        } catch {
            failure = ModelDownloadError(message: "Could not open the partial file: \(error.localizedDescription)", discardPartial: false)
            return false
        }
    }

    /// Without a strong ETag the next attempt cannot prove the partial is still the same file, so it starts over.
    private func saveETag(_ etag: String?) {
        if ResumeRules.isStrong(etag: etag), let etag {
            try? etag.write(to: etagFile, atomically: true, encoding: .utf8)
        } else {
            try? FileManager.default.removeItem(at: etagFile)
        }
    }
}
