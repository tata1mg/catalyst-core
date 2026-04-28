import Foundation
import AVFoundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "TorchController")

/// Manages torch (flashlight) state.
/// Guards against front-camera torch calls.
/// Fires ON_TORCH_CHANGED via onTorchChanged callback.
class TorchController {

    private var device: AVCaptureDevice?
    private var currentFacing: String = "back"
    private let onTorchChanged: (Bool) -> Void

    init(onTorchChanged: @escaping (Bool) -> Void) {
        self.onTorchChanged = onTorchChanged
    }

    func attachDevice(_ device: AVCaptureDevice, facing: String) {
        self.device = device
        self.currentFacing = facing
    }

    func detachDevice() {
        device = nil
    }

    func setTorch(_ on: Bool) {
        guard let device else {
            logger.warning("setTorch(\(on)) — device is nil, skipping")
            return
        }
        guard currentFacing == "back" else {
            logger.warning("setTorch(\(on)) — front camera has no torch, ignoring")
            return
        }
        guard device.hasTorch else {
            logger.warning("setTorch(\(on)) — device has no torch")
            return
        }

        do {
            try device.lockForConfiguration()
            device.torchMode = on ? .on : .off
            device.unlockForConfiguration()
            onTorchChanged(on)
            logger.debug("setTorch(\(on))")
        } catch {
            logger.error("setTorch(\(on)) failed: \(error.localizedDescription)")
        }
    }

    /// Called after every session bind — torch always resets to off on session start.
    func notifyReset() {
        onTorchChanged(false)
        logger.debug("Torch reset to off (new session)")
    }
}
