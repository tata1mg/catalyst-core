//
//  ProgressThrottle.swift
//  catalyst-ai (iOS)
//
//  Kotlin equivalent: the `pct != lastPct || now - lastEmitMs >= 200` check in downloadModel().
//

import Foundation

struct ProgressThrottle {
    let minInterval: TimeInterval
    private var lastPercent = -2
    private var lastEmit: Date?

    init(minInterval: TimeInterval = 0.2) {
        self.minInterval = minInterval
    }

    /// True when a progress event should be emitted now: the percentage changed, or enough time passed.
    mutating func shouldEmit(percent: Int, now: Date = Date()) -> Bool {
        let elapsed = lastEmit.map { now.timeIntervalSince($0) } ?? .infinity
        guard percent != lastPercent || elapsed >= minInterval else { return false }
        lastPercent = percent
        lastEmit = now
        return true
    }
}
