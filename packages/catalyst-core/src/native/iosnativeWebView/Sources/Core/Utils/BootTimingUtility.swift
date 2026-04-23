//
//  BootTimingUtility.swift
//  iosnativeWebView
//
//  Centralized timing utility for measuring app boot performance
//  Only enabled in DEBUG builds for performance testing
//

import Foundation
import os

#if DEBUG
// Global app launch timestamp for all timing measurements
let APP_LAUNCH_TIME = CFAbsoluteTimeGetCurrent()

private let timingLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "Timing")

/// Log a message with milliseconds elapsed since app launch (DEBUG only)
public func logWithTimestamp(_ message: String) {
    let elapsed = String(format: "%.3f", (CFAbsoluteTimeGetCurrent() - APP_LAUNCH_TIME) * 1000)
    timingLogger.info("[\(elapsed)ms] \(message)")
}
#else
// No-op in release builds
public func logWithTimestamp(_ message: String) {}
#endif