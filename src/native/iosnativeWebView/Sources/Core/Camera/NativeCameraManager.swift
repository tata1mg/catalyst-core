import Foundation
import AVFoundation
import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NativeCameraManager")

/// Mutable reference wrapper so all sub-controller closures share the same callback
/// even after rewireEvents()/rewireError() replace it post-construction.
/// NSLock guards concurrent handler replacement vs. invocation.
private final class EventBox {
    private let lock = NSLock()
    private var _handler: (String, [String: Any]?) -> Void
    init(_ h: @escaping (String, [String: Any]?) -> Void) { _handler = h }

    func call(_ event: String, _ payload: [String: Any]?) {
        lock.lock()
        let h = _handler
        lock.unlock()
        h(event, payload)
    }

    func replace(_ h: @escaping (String, [String: Any]?) -> Void) {
        lock.lock()
        _handler = h
        lock.unlock()
    }
}
private final class ErrorBox {
    private let lock = NSLock()
    private var _handler: (String) -> Void
    init(_ h: @escaping (String) -> Void) { _handler = h }

    func call(_ msg: String) {
        lock.lock()
        let h = _handler
        lock.unlock()
        h(msg)
    }

    func replace(_ h: @escaping (String) -> Void) {
        lock.lock()
        _handler = h
        lock.unlock()
    }
}

/// Thin facade — wires all camera sub-components and exposes the public API
/// that NativeBridge.swift calls. Mirrors Android's NativeCameraManager.kt.
public class NativeCameraManager {

    private let stateMachine: VideoStreamStateMachine
    private let zoomController: ZoomController
    private let torchController: TorchController
    private let barcodeDetector: BarcodeDetector
    private let sessionManager: CameraSessionManager
    private let holdController: HoldController

    // Boxes — all sub-controller closures close over these references,
    // so updating .handler here propagates to all of them immediately.
    private let eventBox: EventBox
    private let errorBox: ErrorBox

    public init(onEvent: @escaping (String, [String: Any]?) -> Void,
                onError: @escaping (String) -> Void) {
        let eBox = EventBox(onEvent)
        let errBox = ErrorBox(onError)
        self.eventBox = eBox
        self.errorBox = errBox

        let sm = VideoStreamStateMachine()
        self.stateMachine = sm

        zoomController = ZoomController(
            stateMachine: sm,
            onZoomChanged: { zoomLevel, minZoom, maxZoom in
                let payload: [String: Any] = [
                    "zoomLevel": round(Double(zoomLevel) * 10) / 10,
                    "minZoom":   round(Double(minZoom)   * 10) / 10,
                    "maxZoom":   round(Double(maxZoom)   * 10) / 10
                ]
                eBox.call("ON_ZOOM_CHANGED", payload)
            }
        )

        torchController = TorchController(
            onTorchChanged: { enabled in
                eBox.call("ON_TORCH_CHANGED", ["enabled": enabled])
            }
        )

        barcodeDetector = BarcodeDetector()

        sessionManager = CameraSessionManager(
            stateMachine: sm,
            zoomController: zoomController,
            torchController: torchController,
            barcodeDetector: barcodeDetector,
            onReady:   { eBox.call("ON_VIDEO_STREAM_READY",   nil) },
            onStopped: { eBox.call("ON_VIDEO_STREAM_STOPPED", nil) },
            onError:   { msg in errBox.call(msg) }
        )

        holdController = HoldController(stateMachine: sm, barcodeDetector: barcodeDetector)

        // Wire detection handler now that holdController exists
        barcodeDetector.detectionHandler = { [weak holdController, weak sm] value, type, bounds in
            guard sm?.state != .hold else { return }
            holdController.map { hc in
                if !hc.isNewValue(value) { hc.startHold(); return }
                hc.startHold()
                let payload: [String: Any] = ["value": value, "format": BarcodeDetector.formatName(type)]
                eBox.call("ON_QR_DETECTED", payload)
                logger.debug("QR detected (new): \(value)")
            }
        }
    }

    // MARK: - Public API

    public func setPreviewView(_ view: UIView) {
        sessionManager.setPreviewView(view)
    }

    public func start(facing: String = "back",
                      autoZoom: Bool = false,         // accepted, silently ignored on iOS
                      initialZoom: Float = 1.0,
                      scanFormat: String = "all",
                      fpsMin: Int? = nil,
                      fpsMax: Int? = nil) {
        guard !stateMachine.isActive else { return }
        stateMachine.transition(to: .starting)
        sessionManager.start(
            facing: facing,
            initialZoom: initialZoom,
            scanFormat: scanFormat,
            fpsMin: fpsMin,
            fpsMax: fpsMax
        )
    }

    public func stop() {
        guard stateMachine.isActive else { return }
        holdController.reset()
        stateMachine.transition(to: .stopping)
        sessionManager.stop()
    }

    public func flip() {
        guard stateMachine.isActive else { return }
        holdController.reset()
        stateMachine.transition(to: .flipping)
        sessionManager.flip()
    }

    public func setZoom(multiplier: Float) {
        zoomController.setZoom(multiplier: multiplier)
    }

    public func setTorch(_ on: Bool) {
        torchController.setTorch(on)
    }

    public func setFps(min: Int?, max: Int?) {
        guard stateMachine.isActive else { return }
        sessionManager.setFps(min: min, max: max)
    }

    public func handlePinchBegan() {
        zoomController.handlePinchBegan()
    }

    public func handlePinchChanged(scale: CGFloat) {
        zoomController.handlePinchChanged(scale: scale)
    }

    public func cleanup() {
        sessionManager.cleanup()
    }

    /// Replace the event callback post-construction (called by NativeBridge after init).
    /// Updates the shared EventBox so all sub-controller closures see the new handler.
    public func rewireEvents(_ handler: @escaping (String, [String: Any]?) -> Void) {
        eventBox.replace(handler)
    }

    /// Replace the error callback post-construction (called by NativeBridge after init).
    /// Updates the shared ErrorBox so all sub-controller closures see the new handler.
    public func rewireError(_ handler: @escaping (String) -> Void) {
        errorBox.replace(handler)
    }

    public var isStreaming: Bool { stateMachine.isActive }
}
