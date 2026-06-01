import Foundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "HoldController")

/// Manages QR hold state — after each detection, results are suppressed for HOLD_DURATION
/// to prevent the same QR from firing repeatedly.
/// Uses a suppressResults flag on BarcodeDetector instead of stopping the session,
/// so the camera pipeline stays live and there is no flicker.
class HoldController {

    private let holdDuration: TimeInterval = 0.2  // 200ms, matches Android

    private let stateMachine: VideoStreamStateMachine
    private let barcodeDetector: BarcodeDetector
    private var holdWorkItem: DispatchWorkItem?
    private let serialQueue = DispatchQueue(label: "com.catalyst.camera.hold")

    private(set) var lastDetectedValue: String?

    init(stateMachine: VideoStreamStateMachine, barcodeDetector: BarcodeDetector) {
        self.stateMachine = stateMachine
        self.barcodeDetector = barcodeDetector
    }

    /// Call after a new QR value is confirmed.
    func startHold() {
        guard stateMachine.transition(to: .hold) else { return }

        barcodeDetector.suppressResults = true
        logger.debug("Hold started — results suppressed for \(self.holdDuration * 1000, format: .fixed(precision: 0))ms")

        let workItem = DispatchWorkItem { [weak self] in
            guard let self, self.stateMachine.isActive else { return }
            self.barcodeDetector.suppressResults = false
            self.stateMachine.transition(to: .streaming)
            logger.debug("Hold ended — results resumed")
        }
        holdWorkItem = workItem
        serialQueue.asyncAfter(deadline: .now() + holdDuration, execute: workItem)
    }

    /// Call on stop() or flip() to cancel any pending hold and clear detection memory.
    func reset() {
        serialQueue.async { [weak self] in
            guard let self else { return }
            self.holdWorkItem?.cancel()
            self.holdWorkItem = nil
            self.barcodeDetector.suppressResults = false
            self.lastDetectedValue = nil
            logger.debug("Hold state reset")
        }
    }

    /// Returns true if this value is new (not a repeat of the last detected value).
    func isNewValue(_ value: String) -> Bool {
        serialQueue.sync {
            if value == lastDetectedValue { return false }
            lastDetectedValue = value
            return true
        }
    }
}
