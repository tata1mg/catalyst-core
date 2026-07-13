import Foundation
import WebKit
import MachO

enum CatalystPerf {
    private static let maxBufferSize = 500
    private static let flushDelayMs: UInt64 = 250
    private static let periodicFlushIntervalMs: UInt64 = 4_000
    private static let lock = NSLock()

    private static var buffer: [[String: Any]] = []
    private static var pendingCalls: [String: (startMs: Int64, method: String)] = [:]
    private static var flushed = false
    private static weak var periodicWebView: WKWebView?
    private static var periodicTask: Task<Void, Never>?

    private static var cacheHits = 0
    private static var cacheMisses = 0
    private static var cacheFetches = 0
    private static var cacheTotalMs: Int64 = 0
    private static var cacheTopSlow: [(durationMs: Int64, filename: String)] = []

    static func nativeTimeMs() -> Int64 {
        Int64(ProcessInfo.processInfo.systemUptime * 1000)
    }

    static func add(_ event: [String: Any]) {
        #if DEBUG
        guard ConfigConstants.Profiler.enabled else { return }
        var payload = event
        if payload["nativeTime"] == nil {
            payload["nativeTime"] = nativeTimeMs()
        }

        lock.lock()
        if buffer.count >= maxBufferSize {
            buffer.removeFirst()
        }
        updateCacheSummaryLocked(payload)
        buffer.append(payload)
        lock.unlock()
        #endif
    }

    static func emit(_ event: [String: Any], to webView: WKWebView?) {
        #if DEBUG
        guard ConfigConstants.Profiler.enabled else { return }
        guard let webView else {
            add(event)
            return
        }

        var payload = event
        if payload["nativeTime"] == nil {
            payload["nativeTime"] = nativeTimeMs()
        }

        DispatchQueue.main.async {
            guard let json = jsonString(payload) else { return }
            let script = "window.__catalystPerfEvent && window.__catalystPerfEvent(\(javaScriptStringLiteral(json)));"
            webView.evaluateJavaScript(script)
        }
        #endif
    }

    static func bridgeCallReceived(callId: String, method: String) {
        #if DEBUG
        guard ConfigConstants.Profiler.enabled else { return }
        lock.lock()
        pendingCalls[callId] = (nativeTimeMs(), method)
        lock.unlock()
        #endif
    }

    static func bridgeCallDispatched(callId: String) {
        #if DEBUG
        guard ConfigConstants.Profiler.enabled else { return }
        lock.lock()
        guard let pending = pendingCalls.removeValue(forKey: callId) else {
            lock.unlock()
            return
        }
        lock.unlock()

        let endMs = nativeTimeMs()
        add([
            "type": "api-call",
            "callId": callId,
            "method": pending.method,
            "nativeStartMs": pending.startMs,
            "nativeEndMs": endMs,
            "durationMs": endMs - pending.startMs,
            "thread": Thread.current.name ?? "unknown",
        ])
        #endif
    }

    static func scheduleFlush(_ webView: WKWebView?) {
        #if DEBUG
        guard ConfigConstants.Profiler.enabled else { return }
        guard let webView else { return }

        lock.lock()
        if flushed {
            lock.unlock()
            return
        }
        flushed = true
        lock.unlock()

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: flushDelayMs * 1_000_000)
            flush(webView, includeCacheSummary: true)
            startPeriodicFlush(webView)
        }
        #endif
    }

    static func flushNow(_ webView: WKWebView?) {
        #if DEBUG
        guard ConfigConstants.Profiler.enabled else { return }
        guard let webView else { return }
        Task { @MainActor in
            flush(webView, includeCacheSummary: false)
        }
        #endif
    }

    static func reset() {
        #if DEBUG
        stopPeriodicFlush()
        lock.lock()
        buffer.removeAll()
        pendingCalls.removeAll()
        flushed = false
        cacheHits = 0
        cacheMisses = 0
        cacheFetches = 0
        cacheTotalMs = 0
        cacheTopSlow.removeAll()
        lock.unlock()
        #endif
    }

    static func memorySnapshot(to webView: WKWebView?, label: String? = nil) {
        #if DEBUG
        guard ConfigConstants.Profiler.enabled else { return }
        let currentMb = currentResidentMemoryMb()
        let event: [String: Any] = [
            "type": "memory-snapshot",
            "nativeTime": nativeTimeMs(),
            "jvmMb": 0,
            "webviewMb": currentMb,
            "nativeMb": currentMb,
            "totalMb": currentMb,
            "otherMb": 0,
            "peakMb": currentMb,
            "thread": Thread.current.name ?? "unknown",
            "label": label ?? "ios-process",
        ]

        if let webView {
            emit(event, to: webView)
        } else {
            add(event)
        }
        #endif
    }

    static func injectNativeTimeOffset(into webView: WKWebView?) {
        #if DEBUG
        guard ConfigConstants.Profiler.enabled else { return }
        guard let webView else { return }
        let nativeNow = nativeTimeMs()
        DispatchQueue.main.async {
            webView.evaluateJavaScript("window.__NATIVE_TIME_OFFSET = \(nativeNow) - performance.now();")
        }
        #endif
    }

    private static func startPeriodicFlush(_ webView: WKWebView) {
        periodicTask?.cancel()
        periodicWebView = webView
        periodicTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: periodicFlushIntervalMs * 1_000_000)
                guard let webView = periodicWebView else { return }
                flush(webView, includeCacheSummary: false)
                memorySnapshot(to: webView, label: "periodic")
            }
        }
    }

    private static func stopPeriodicFlush() {
        periodicTask?.cancel()
        periodicTask = nil
        periodicWebView = nil
    }

    @MainActor
    private static func flush(_ webView: WKWebView, includeCacheSummary: Bool) {
        lock.lock()
        var events = buffer
        buffer.removeAll()
        if includeCacheSummary, let summary = buildCacheSummaryEventLocked() {
            events.append(summary)
        }
        lock.unlock()

        guard !events.isEmpty, let json = jsonString(events) else { return }
        let script = "window.__catalystPerfBatch && window.__catalystPerfBatch(\(javaScriptStringLiteral(json)));"
        webView.evaluateJavaScript(script)
    }

    private static func updateCacheSummaryLocked(_ event: [String: Any]) {
        guard let type = event["type"] as? String else { return }
        let durationMs = event["durationMs"] as? Int64 ?? Int64(event["durationMs"] as? Int ?? 0)
        let url = event["url"] as? String ?? ""

        switch type {
        case "cache-hit-memory", "cache-hit-disk":
            cacheHits += 1
        case "cache-miss-fetch":
            cacheMisses += 1
        case "network-fetch-complete":
            cacheFetches += 1
            cacheTotalMs += durationMs
            cacheTopSlow.append((durationMs, filename(from: url)))
            cacheTopSlow = Array(cacheTopSlow.sorted { $0.durationMs > $1.durationMs }.prefix(5))
        default:
            break
        }
    }

    private static func buildCacheSummaryEventLocked() -> [String: Any]? {
        let total = cacheHits + cacheMisses
        guard total > 0 else { return nil }
        let hitRate = Double(cacheHits) * 100.0 / Double(total)
        let avgFetchMs = cacheFetches > 0 ? cacheTotalMs / Int64(cacheFetches) : 0
        return [
            "type": "cache-summary",
            "hits": cacheHits,
            "misses": cacheMisses,
            "fetches": cacheFetches,
            "total": total,
            "hitRatePct": (hitRate * 10).rounded() / 10,
            "avgFetchMs": avgFetchMs,
            "topSlowest": cacheTopSlow.map { ["filename": $0.filename, "durationMs": $0.durationMs] },
            "nativeTime": nativeTimeMs(),
        ]
    }

    private static func currentResidentMemoryMb() -> Int {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return 0 }
        return Int(info.resident_size / 1024 / 1024)
    }

    private static func filename(from url: String) -> String {
        URL(string: url)?.lastPathComponent.prefix(40).description ?? String(url.prefix(40))
    }

    private static func jsonString(_ object: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return json
    }

    private static func javaScriptStringLiteral(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return "'\(escaped)'"
    }
}
