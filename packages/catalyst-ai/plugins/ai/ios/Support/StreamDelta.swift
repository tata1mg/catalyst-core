//
//  StreamDelta.swift
//  catalyst-ai (iOS)
//
//  Android's token flow yields deltas, and the JS side appends each `token` frame. The iOS engines
//  stream the text generated so far (LiteRT-LM's Swift sendMessageStream per its docs, and Foundation
//  Models snapshots), so each update is converted to the new suffix before it reaches the SSE frame.
//  Without this the UI would render duplicated text.
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
