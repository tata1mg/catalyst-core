//
//  DownloadControl.swift
//  catalyst-ai (iOS)
//
//  Kotlin equivalent: DownloadControl.kt. Keep the two in step.
//
//  What a model download needs to survive a bad connection, kept free of URLSession so it can be tested:
//  the policy (how slow is "weak", how long to wait), a gate the JS side pauses and resumes (the page learns about
//  connectivity from useNetworkStatus), a throughput window that spots a weak link, and the retry backoff.
//

import Foundation

enum PauseReason: String {
    /// The page reported the device offline.
    case offline
    /// The transfer fell below the minimum speed for a sustained window.
    case weak
    /// A transient failure (reset connection, timeout, 5xx); retrying with backoff.
    case error
}

/// Tunable from config.json (`AI_CONFIG.browser.download`); out-of-range values are clamped, never rejected.
struct DownloadPolicy: Equatable {
    /// Below this many bytes per second, sustained for `windowSec`, the link counts as weak.
    var minBytesPerSec: Double = 50_000
    var windowSec: TimeInterval = 20
    /// First wait before retrying after a weak link or an error; doubles each time without progress, capped.
    var resumeDelaySec: TimeInterval = 10
    var maxDelaySec: TimeInterval = 120
    /// Attempts in a row that moved no bytes before the download gives up (the partial stays on disk).
    var maxIdleRetries: Int = 8
    /// While the page says "offline", try again on this interval anyway, in case the page never hears the network return.
    var heldRetrySec: TimeInterval = 120

    static let `default` = DownloadPolicy()

    init() {}

    init(object: [String: Any]?) {
        guard let object else { return }
        func number(_ key: String) -> Double? { (object[key] as? NSNumber)?.doubleValue }
        if let v = number("minBytesPerSec") { minBytesPerSec = min(max(v, 0), 50_000_000) }
        if let v = number("windowSec") { windowSec = min(max(v, 5), 300) }
        if let v = number("resumeDelaySec") { resumeDelaySec = min(max(v, 1), 600) }
        if let v = number("maxIdleRetries") { maxIdleRetries = Int(min(max(v, 1), 50)) }
        maxDelaySec = max(maxDelaySec, resumeDelaySec)
    }

    /// Wait before retry number `attempt` (1-based): resumeDelaySec, doubling, capped.
    func backoff(attempt: Int) -> TimeInterval {
        let exponent = Double(max(attempt - 1, 0))
        return min(maxDelaySec, resumeDelaySec * pow(2, exponent))
    }
}

/// Shared between the bridge commands (pauseDownload / resumeDownload) and the download loop.
final class DownloadGate {
    static let shared = DownloadGate()

    private let lock = NSLock()
    private var reason: PauseReason?
    private var waiters: [UUID: CheckedContinuation<Bool, Never>] = [:]
    private var pauseHandler: ((PauseReason) -> Void)?

    /// Why the page paused the download, or nil when it is running.
    var pausedReason: PauseReason? { lock.withLock { reason } }

    /// The transfer in flight registers here so a pause interrupts it instead of waiting for it to finish.
    func setPauseHandler(_ handler: ((PauseReason) -> Void)?) {
        lock.withLock { pauseHandler = handler }
    }

    func pause(_ newReason: PauseReason) {
        let handler: ((PauseReason) -> Void)? = lock.withLock {
            reason = newReason
            return pauseHandler
        }
        handler?(newReason)
    }

    /// Clears the pause and wakes everything waiting: a held download, or a backoff nap that can now end early.
    func resume() {
        let toWake: [CheckedContinuation<Bool, Never>] = lock.withLock {
            reason = nil
            let all = Array(waiters.values)
            waiters.removeAll()
            return all
        }
        toWake.forEach { $0.resume(returning: true) }
    }

    /// Returns true when woken by `resume()`, false when `timeout` passed first (or the task was cancelled).
    @discardableResult
    func nap(seconds: TimeInterval) async -> Bool {
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                lock.withLock { waiters[id] = continuation }
                DispatchQueue.global().asyncAfter(deadline: .now() + max(seconds, 0)) { [weak self] in
                    self?.wake(id, resumedByCommand: false)
                }
            }
        } onCancel: {
            self.wake(id, resumedByCommand: false)
        }
    }

    private func wake(_ id: UUID, resumedByCommand: Bool) {
        let continuation = lock.withLock { waiters.removeValue(forKey: id) }
        continuation?.resume(returning: resumedByCommand)
    }
}

/// Spots a weak link: bytes per second over a sliding window. The first chunk starts the clock, so connection setup
/// and redirects are not counted against the link. A transfer that delivers nothing at all is caught by the request
/// timeout instead (no callbacks arrive to measure).
struct ThroughputWindow {
    enum Verdict: Equatable {
        case ok
        case weak(bytesPerSec: Double)
    }

    let minBytesPerSec: Double
    let windowSec: TimeInterval
    private var windowStart: Date?
    private var bytes: Int64 = 0

    init(minBytesPerSec: Double, windowSec: TimeInterval) {
        self.minBytesPerSec = minBytesPerSec
        self.windowSec = windowSec
    }

    mutating func record(bytes count: Int64, at now: Date = Date()) -> Verdict {
        guard let start = windowStart else {
            windowStart = now
            bytes = 0 // the first chunk only starts the clock
            return .ok
        }
        bytes += count
        let elapsed = now.timeIntervalSince(start)
        guard elapsed >= windowSec else { return .ok }
        let rate = Double(bytes) / elapsed
        windowStart = now
        bytes = 0
        return rate < minBytesPerSec ? .weak(bytesPerSec: rate) : .ok
    }
}
