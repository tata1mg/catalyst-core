//
//  ResilientDownload.swift
//  catalyst-ai (iOS)
//
//  Kotlin equivalent: ResilientDownload in ResumableDownloader.kt. Keep the two in step.
//
//  Runs a resumable download until it finishes, across the things a phone connection does: the page reports offline
//  (pauseDownload), the link goes too slow (DownloadInterrupted.weak), the connection resets or times out. Every
//  attempt resumes from the partial, so waiting costs nothing already downloaded.
//

import Foundation

enum DownloadStatus: Equatable {
    /// Waiting to try again. `retryInSec` is nil when the wait ends only when the page resumes (or the safety net).
    case paused(PauseReason, retryInSec: Int?)
    case resuming
}

final class ResilientDownload {
    private let policy: DownloadPolicy
    private let gate: DownloadGate
    private let partialSize: () -> Int64
    private let onLog: (String) -> Void
    private let emit: (DownloadStatus) -> Void

    init(policy: DownloadPolicy, gate: DownloadGate = .shared, partialSize: @escaping () -> Int64,
         onLog: @escaping (String) -> Void = { _ in }, emit: @escaping (DownloadStatus) -> Void) {
        self.policy = policy
        self.gate = gate
        self.partialSize = partialSize
        self.onLog = onLog
        self.emit = emit
    }

    static func isTransient(_ error: Error) -> Bool {
        if let download = error as? ModelDownloadError { return download.transient }
        guard let url = error as? URLError else { return false }
        switch url.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost,
             .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .secureConnectionFailed,
             .cannotLoadFromNetwork, .resourceUnavailable:
            return true
        default:
            return false
        }
    }

    /// `attempt` performs one resumable download and returns the final size.
    func run(_ attempt: () async throws -> Int64) async throws -> Int64 {
        var idle = 0          // attempts in a row that moved no bytes
        var weakStreak = 0    // consecutive weak-link interruptions: the wait between them grows
        var lastSize = partialSize()

        while true {
            try Task.checkCancellation()

            if let reason = gate.pausedReason {
                emit(.paused(reason, retryInSec: nil))
                let resumed = await gate.nap(seconds: policy.heldRetrySec)
                try Task.checkCancellation()
                if !resumed {
                    // The page never said the network came back (it may have been suspended): try anyway.
                    onLog("Still paused by the page after \(Int(policy.heldRetrySec))s; trying again")
                    gate.resume()
                }
                emit(.resuming)
            }

            var reason: PauseReason = .error
            do {
                return try await attempt()
            } catch let interrupted as DownloadInterrupted {
                switch interrupted.kind {
                case .paused:
                    continue // the top of the loop waits on the gate
                case .weak(let rate):
                    reason = .weak
                    weakStreak += 1
                    onLog("Weak connection (\(Int(rate / 1000)) KB/s); waiting before trying again")
                }
            } catch {
                guard Self.isTransient(error) else { throw error }
                weakStreak = 0
                onLog("Download interrupted (\(error.localizedDescription)); will retry")
            }

            let size = partialSize()
            if size > lastSize { idle = 0 } else { idle += 1 }
            lastSize = size
            if idle > policy.maxIdleRetries {
                throw ModelDownloadError(
                    message: "Download made no progress after \(idle) attempts; the partial file is kept for the next try",
                    discardPartial: false
                )
            }

            let delay = policy.backoff(attempt: reason == .weak ? weakStreak : max(idle, 1))
            emit(.paused(reason, retryInSec: Int(delay.rounded(.up))))
            await gate.nap(seconds: delay) // the page's resumeDownload ends this early
            try Task.checkCancellation()
            emit(.resuming)
        }
    }
}
