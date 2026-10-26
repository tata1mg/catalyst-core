//
//  StreamDelta.swift
//  catalyst-ai (iOS)
//
//  The JS side appends each SSE `token` frame, so frames must carry deltas. LiteRT-LM already streams
//  deltas, but Apple Foundation Models streams snapshots (the text so far), so those are converted
//  to the new suffix here. Without this the UI would render duplicated text.
//

import Foundation

struct StreamDelta {
    private(set) var emitted = ""

    /// Returns only the part of `cumulative` not yet emitted. If the engine rewrote earlier text
    /// (so `cumulative` no longer extends what was sent) nothing can be un-sent; the divergent tail is
    /// returned so no new text is lost, and tracking resets to the engine's text.
    mutating func next(_ cumulative: String) -> String {
        if cumulative.hasPrefix(emitted) {
            let delta = String(cumulative.dropFirst(emitted.count))
            emitted = cumulative
            return delta
        }
        let common = cumulative.commonPrefix(with: emitted)
        let delta = String(cumulative.dropFirst(common.count))
        emitted = cumulative
        return delta
    }
}
