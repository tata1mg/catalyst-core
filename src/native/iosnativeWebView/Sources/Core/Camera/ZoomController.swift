import Foundation
import AVFoundation
import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "ZoomController")

/// Handles zoom operations:
///  - setZoom(multiplier:) via bridge — 1.0 = 1x, 2.0 = 2x
///  - pinch-to-zoom via UIPinchGestureRecognizer
///
/// Fires ON_ZOOM_CHANGED via onZoomChanged callback after each zoom change.
/// Payload: zoomLevel (Float multiplier), minZoom, maxZoom.
///
/// Note: iOS has no ML Kit auto-zoom suggestion equivalent.
/// autoZoom option in start() is accepted but silently ignored on iOS.
class ZoomController: NSObject {

    private var device: AVCaptureDevice?
    private let stateMachine: VideoStreamStateMachine
    private let onZoomChanged: (Float, Float, Float) -> Void  // (zoomLevel, minZoom, maxZoom)

    // Track current zoom so pinch can compute relative delta
    private var zoomAtPinchStart: CGFloat = 1.0
    private var isObservingZoom = false

    init(stateMachine: VideoStreamStateMachine,
         onZoomChanged: @escaping (Float, Float, Float) -> Void) {
        self.stateMachine = stateMachine
        self.onZoomChanged = onZoomChanged
    }

    func attachDevice(_ device: AVCaptureDevice) {
        if isObservingZoom {
            self.device?.removeObserver(self, forKeyPath: #keyPath(AVCaptureDevice.videoZoomFactor))
            isObservingZoom = false
        }
        self.device = device
        device.addObserver(self, forKeyPath: #keyPath(AVCaptureDevice.videoZoomFactor), options: [.new], context: nil)
        isObservingZoom = true
    }

    func detachDevice() {
        if isObservingZoom {
            device?.removeObserver(self, forKeyPath: #keyPath(AVCaptureDevice.videoZoomFactor))
            isObservingZoom = false
        }
        device = nil
    }

    deinit {
        if isObservingZoom {
            device?.removeObserver(self, forKeyPath: #keyPath(AVCaptureDevice.videoZoomFactor))
        }
    }

    override func observeValue(forKeyPath keyPath: String?,
                               of object: Any?,
                               change: [NSKeyValueChangeKey: Any]?,
                               context: UnsafeMutableRawPointer?) {
        guard keyPath == #keyPath(AVCaptureDevice.videoZoomFactor),
              let device = object as? AVCaptureDevice else {
            super.observeValue(forKeyPath: keyPath, of: object, change: change, context: context)
            return
        }
        let current = Float(device.videoZoomFactor)
        let minZ    = Float(device.minAvailableVideoZoomFactor)
        let maxZ    = Float(device.maxAvailableVideoZoomFactor)
        DispatchQueue.main.async { [weak self] in
            self?.onZoomChanged(current, minZ, maxZ)
        }
    }

    // MARK: - Bridge API

    /// Called by NativeBridge setVideoStreamZoom — snaps instantly (no animation ramp).
    func setZoom(multiplier: Float) {
        logger.debug("setZoom(\(multiplier)x) called from bridge")
        applyZoomMultiplier(CGFloat(multiplier), animated: false)
    }

    /// Apply zoom to the device.
    /// - animated: false → cancel any in-progress ramp and assign directly (bridge calls).
    ///             true  → let AVFoundation smooth-ramp (pinch gesture).
    func applyZoomMultiplier(_ multiplier: CGFloat, animated: Bool = false) {
        guard let device else {
            logger.warning("applyZoomMultiplier(\(multiplier)x) — device is nil, skipping")
            return
        }
        let minFactor = device.minAvailableVideoZoomFactor
        let maxFactor = device.maxAvailableVideoZoomFactor
        let clamped = multiplier.clamped(to: minFactor...maxFactor)
        do {
            try device.lockForConfiguration()
            if animated {
                // Smooth ramp for pinch — preserve natural feel.
                // KVO on videoZoomFactor fires onZoomChanged as the ramp progresses.
                device.ramp(toVideoZoomFactor: clamped, withRate: 8.0)
            } else {
                // Instant snap for bridge calls.
                // cancelVideoZoomRamp + direct assign triggers one KVO notification.
                device.cancelVideoZoomRamp()
                device.videoZoomFactor = clamped
            }
            device.unlockForConfiguration()
            logger.debug("applyZoomMultiplier(\(multiplier)x) → \(clamped)x animated=\(animated)")
        } catch {
            logger.error("applyZoomMultiplier failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Pinch gesture

    func handlePinchBegan() {
        zoomAtPinchStart = device?.videoZoomFactor ?? 1.0
    }

    func handlePinchChanged(scale: CGFloat) {
        guard stateMachine.isActive else { return }
        applyZoomMultiplier(zoomAtPinchStart * scale, animated: true)
    }
}

// MARK: - Comparable+clamped helper (avoids importing simd)

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
