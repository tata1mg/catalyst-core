import Foundation
import AVFoundation
import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "CameraSessionManager")

/// Owns the AVCaptureSession lifecycle: configure, start, stop, flip, setFps.
/// Mirrors Android's CameraSessionManager.kt — same public API shape.
class CameraSessionManager: NSObject {

    private let stateMachine: VideoStreamStateMachine
    private let zoomController: ZoomController
    private let torchController: TorchController
    private let barcodeDetector: BarcodeDetector
    private let onReady: () -> Void
    private let onStopped: () -> Void
    private let onError: (String) -> Void

    private var session: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private weak var previewView: UIView?
    private let sessionQueue = DispatchQueue(label: "com.catalyst.camera.session")

    // Session params — stored so flip/setFps can rebind with same settings.
    // paramsLock guards reads/writes since callers may be on any thread while
    // sessionQueue reads them concurrently.
    private let paramsLock = NSLock()
    private var _currentFacing: String = "back"
    private var _currentFpsMin: Int?
    private var _currentFpsMax: Int?
    private var _currentScanFormat: String = "all"
    private var _currentInitialZoom: Float = 1.0

    private var currentFacing: String {
        get { paramsLock.lock(); defer { paramsLock.unlock() }; return _currentFacing }
        set { paramsLock.lock(); _currentFacing = newValue; paramsLock.unlock() }
    }
    private var currentFpsMin: Int? {
        get { paramsLock.lock(); defer { paramsLock.unlock() }; return _currentFpsMin }
        set { paramsLock.lock(); _currentFpsMin = newValue; paramsLock.unlock() }
    }
    private var currentFpsMax: Int? {
        get { paramsLock.lock(); defer { paramsLock.unlock() }; return _currentFpsMax }
        set { paramsLock.lock(); _currentFpsMax = newValue; paramsLock.unlock() }
    }
    private var currentScanFormat: String {
        get { paramsLock.lock(); defer { paramsLock.unlock() }; return _currentScanFormat }
        set { paramsLock.lock(); _currentScanFormat = newValue; paramsLock.unlock() }
    }
    private var currentInitialZoom: Float {
        get { paramsLock.lock(); defer { paramsLock.unlock() }; return _currentInitialZoom }
        set { paramsLock.lock(); _currentInitialZoom = newValue; paramsLock.unlock() }
    }

    init(stateMachine: VideoStreamStateMachine,
         zoomController: ZoomController,
         torchController: TorchController,
         barcodeDetector: BarcodeDetector,
         onReady: @escaping () -> Void,
         onStopped: @escaping () -> Void,
         onError: @escaping (String) -> Void) {
        self.stateMachine = stateMachine
        self.zoomController = zoomController
        self.torchController = torchController
        self.barcodeDetector = barcodeDetector
        self.onReady = onReady
        self.onStopped = onStopped
        self.onError = onError
    }

    // MARK: - Public API

    func setPreviewView(_ view: UIView) {
        previewView = view
    }

    func start(facing: String,
               initialZoom: Float,
               scanFormat: String,
               fpsMin: Int?,
               fpsMax: Int?) {
        currentFacing = facing
        currentInitialZoom = initialZoom
        currentScanFormat = scanFormat
        currentFpsMin = fpsMin
        currentFpsMax = fpsMax

        checkPermissionAndBind()
    }

    func stop() {
        sessionQueue.async { [weak self] in
            self?.tearDownSession()
        }
    }

    func flip() {
        currentFacing = (currentFacing == "back") ? "front" : "back"
        logger.debug("flip() → \(self.currentFacing)")
        sessionQueue.async { [weak self] in
            self?.rebindSession()
        }
    }

    func setFps(min: Int?, max: Int?) {
        logger.debug("setFps(\(String(describing: min)), \(String(describing: max))) — applying live or rebind")
        currentFpsMin = min
        currentFpsMax = max
        sessionQueue.async { [weak self] in
            self?.applyFpsToLiveDevice()
        }
    }

    func cleanup() {
        sessionQueue.async { [weak self] in
            self?.tearDownSession()
        }
    }

    // MARK: - Permission

    private func checkPermissionAndBind() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            sessionQueue.async { [weak self] in self?.bindSession() }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted {
                    self?.sessionQueue.async { self?.bindSession() }
                } else {
                    self?.stateMachine.transition(to: .idle)
                    self?.onError("Camera permission denied")
                }
            }
        default:
            stateMachine.transition(to: .idle)
            onError("Camera permission denied")
        }
    }

    // MARK: - Session lifecycle

    private func bindSession() {
        let newSession = AVCaptureSession()
        newSession.beginConfiguration()
        newSession.sessionPreset = .hd1920x1080

        // Input
        let position: AVCaptureDevice.Position = (currentFacing == "front") ? .front : .back
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
              let input = try? AVCaptureDeviceInput(device: device) else {
            stateMachine.transition(to: .idle)
            onError("Failed to open camera device")
            return
        }
        guard newSession.canAddInput(input) else {
            stateMachine.transition(to: .idle)
            onError("Cannot add camera input")
            return
        }
        newSession.addInput(input)

        // FPS
        configureFPS(device: device, fpsMin: currentFpsMin, fpsMax: currentFpsMax)

        // Preview layer — must be created before addOutput so transforms are correct
        let layer = AVCaptureVideoPreviewLayer(session: newSession)
        layer.videoGravity = .resizeAspectFill

        newSession.commitConfiguration()

        // Attach barcode detector (adds AVCaptureMetadataOutput to session)
        barcodeDetector.attach(to: newSession, previewLayer: layer, scanFormat: currentScanFormat)

        // Controllers
        zoomController.attachDevice(device)
        torchController.attachDevice(device, facing: currentFacing)

        // Apply initial zoom before starting
        zoomController.applyZoomMultiplier(CGFloat(currentInitialZoom))
        torchController.notifyReset()

        self.session = newSession
        self.previewLayer = layer

        newSession.startRunning()

        // Embed preview layer and fire onReady on main thread.
        // Preview layer insertion is best-effort — previewView is a weak ref to a
        // SwiftUI-managed UIView that should always be ready by the time JS calls start(),
        // but we don't gate onReady() on it. Matches Android: onReady fires as soon as
        // the camera is bound, regardless of the preview container state.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let view = self.previewView {
                layer.frame = view.bounds
                view.layer.insertSublayer(layer, at: 0)
            }
            self.stateMachine.transition(to: .streaming)
            self.onReady()
            logger.debug("Session started — facing=\(self.currentFacing)")
        }
    }

    private func tearDownSession() {
        guard let session else { return }
        session.stopRunning()
        barcodeDetector.detach(from: session)
        zoomController.detachDevice()
        torchController.detachDevice()
        self.session = nil

        DispatchQueue.main.async { [weak self] in
            self?.previewLayer?.removeFromSuperlayer()
            self?.previewLayer = nil
            self?.stateMachine.transition(to: .idle)
            self?.onStopped()
        }
        logger.debug("Session torn down")
    }

    private func rebindSession() {
        guard let session else { return }
        session.stopRunning()
        barcodeDetector.detach(from: session)
        zoomController.detachDevice()
        torchController.detachDevice()
        self.session = nil
        DispatchQueue.main.async { [weak self] in
            self?.previewLayer?.removeFromSuperlayer()
            self?.previewLayer = nil
        }
        bindSession()
    }

    /// Apply FPS change to the live device without stopping/restarting the session.
    /// Eliminates the screen blank that rebindSession() causes.
    /// Falls back to rebindSession() if no active session exists yet.
    private func applyFpsToLiveDevice() {
        guard let session,
              let input = session.inputs.first as? AVCaptureDeviceInput else {
            logger.warning("applyFpsToLiveDevice — no active session, falling back to rebind")
            rebindSession()
            return
        }
        let device = input.device
        guard let fpsMin = currentFpsMin, let fpsMax = currentFpsMax else {
            logger.debug("applyFpsToLiveDevice — no FPS values set, skipping")
            return
        }

        let targetMin = CMTime(value: 1, timescale: CMTimeScale(fpsMin))
        let targetMax = CMTime(value: 1, timescale: CMTimeScale(fpsMax))

        let supported = device.activeFormat.videoSupportedFrameRateRanges.first { range in
            range.minFrameDuration <= targetMin && range.maxFrameDuration >= targetMax
        }
        guard supported != nil else {
            logger.warning("applyFpsToLiveDevice — FPS \(fpsMin)-\(fpsMax) unsupported by current format, falling back to rebind")
            rebindSession()
            return
        }

        // Wrap in beginConfiguration/commitConfiguration to prevent AVCaptureSession
        // from triggering an internal _buildAndRunGraph (which causes a screen blank).
        // lockForConfiguration must be called inside the begin/commit pair.
        session.beginConfiguration()
        do {
            try device.lockForConfiguration()
            device.activeVideoMinFrameDuration = targetMax  // min duration = max fps
            device.activeVideoMaxFrameDuration = targetMin  // max duration = min fps
            device.unlockForConfiguration()
        } catch {
            session.commitConfiguration()
            logger.error("applyFpsToLiveDevice — lockForConfiguration failed: \(error.localizedDescription), falling back to rebind")
            rebindSession()
            return
        }
        session.commitConfiguration()
        logger.debug("applyFpsToLiveDevice — FPS set to \(fpsMin)-\(fpsMax) without session rebind")
    }

    // MARK: - FPS configuration

    private func configureFPS(device: AVCaptureDevice, fpsMin: Int?, fpsMax: Int?) {
        guard let fpsMin, let fpsMax else { return }
        let targetMin = CMTime(value: 1, timescale: CMTimeScale(fpsMin))
        let targetMax = CMTime(value: 1, timescale: CMTimeScale(fpsMax))

        let supported = device.activeFormat.videoSupportedFrameRateRanges.first { range in
            range.minFrameDuration <= targetMin && range.maxFrameDuration >= targetMax
        }
        guard supported != nil else {
            logger.warning("FPS range \(fpsMin)-\(fpsMax) not supported by device format, ignoring")
            return
        }
        do {
            try device.lockForConfiguration()
            device.activeVideoMinFrameDuration = targetMax  // min duration = max fps
            device.activeVideoMaxFrameDuration = targetMin  // max duration = min fps
            device.unlockForConfiguration()
            logger.debug("FPS set to \(fpsMin)-\(fpsMax)")
        } catch {
            logger.error("Failed to set FPS: \(error.localizedDescription)")
        }
    }
}
