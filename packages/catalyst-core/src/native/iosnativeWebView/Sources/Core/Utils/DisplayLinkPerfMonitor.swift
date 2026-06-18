import UIKit
import WebKit

final class DisplayLinkPerfMonitor {
    private weak var webView: WKWebView?
    private var displayLink: CADisplayLink?
    private var dropStartMs: Int64?
    private var minFps: Double = 60
    private var fpsSum: Double = 0
    private var sampleCount = 0
    private var lastTimestamp: CFTimeInterval?

    private let dropThresholdFps = 45.0
    private let minDropDurationMs: Int64 = 250

    init(webView: WKWebView) {
        self.webView = webView
    }

    func start() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func stop() {
        displayLink?.invalidate()
        displayLink = nil
        dropStartMs = nil
        sampleCount = 0
        fpsSum = 0
        minFps = 60
        lastTimestamp = nil
    }

    @objc private func tick(_ link: CADisplayLink) {
        defer { lastTimestamp = link.timestamp }
        guard let lastTimestamp else { return }
        let frameDuration = link.timestamp - lastTimestamp
        guard frameDuration > 0 else { return }
        let fps = min(60.0, 1.0 / frameDuration)
        let now = CatalystPerf.nativeTimeMs()

        if fps < dropThresholdFps {
            if dropStartMs == nil {
                dropStartMs = now
                minFps = fps
                fpsSum = 0
                sampleCount = 0
            }
            minFps = min(minFps, fps)
            fpsSum += fps
            sampleCount += 1
            return
        }

        guard let startMs = dropStartMs else { return }
        let durationMs = now - startMs
        if durationMs >= minDropDurationMs, sampleCount > 0 {
            CatalystPerf.emit([
                "type": "fps-drop-episode",
                "nativeTime": startMs,
                "durationMs": durationMs,
                "minFps": minFps,
                "avgFps": fpsSum / Double(sampleCount),
            ], to: webView)
        }

        dropStartMs = nil
        sampleCount = 0
        fpsSum = 0
        minFps = 60
    }
}
