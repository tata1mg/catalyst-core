import Foundation
import AVFoundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "BarcodeDetector")

/// Wraps AVCaptureMetadataOutput for barcode/QR detection.
/// Hardware-accelerated — lower CPU than Vision framework.
/// Fires onDetected with the raw string value and the bounding box in
/// AVCaptureVideoPreviewLayer coordinates (normalized metadata object rect).
class BarcodeDetector: NSObject {

    /// Set by NativeCameraManager after all components are wired up.
    var detectionHandler: ((String, AVMetadataObject.ObjectType, CGRect) -> Void)?

    /// When true, frames still flow through the pipeline but results are not forwarded.
    var suppressResults = false

    private var metadataOutput: AVCaptureMetadataOutput?
    private weak var previewLayer: AVCaptureVideoPreviewLayer?
    private var activeFormats: [AVMetadataObject.ObjectType] = []

    // MARK: - Setup

    /// Attach metadata output to a running session. Call after session is configured but before startRunning.
    func attach(to session: AVCaptureSession,
                previewLayer: AVCaptureVideoPreviewLayer,
                scanFormat: String) {
        self.previewLayer = previewLayer
        self.activeFormats = resolveFormats(scanFormat)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            logger.error("Cannot add AVCaptureMetadataOutput to session")
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)

        // Set types AFTER adding to session
        let supported = output.availableMetadataObjectTypes
        let filtered = activeFormats.filter { supported.contains($0) }
        let typesToSet = filtered.isEmpty
            ? (supported.contains(.qr) ? [AVMetadataObject.ObjectType.qr] : Array(supported.prefix(1)))
            : filtered
        output.metadataObjectTypes = typesToSet

        self.metadataOutput = output
        logger.debug("BarcodeDetector attached — formats: \(filtered.map { $0.rawValue })")
    }

    func detach(from session: AVCaptureSession) {
        if let output = metadataOutput {
            session.removeOutput(output)
        }
        metadataOutput = nil
        previewLayer = nil
        logger.debug("BarcodeDetector detached")
    }

    // MARK: - Format resolution

    private func resolveFormats(_ scan: String) -> [AVMetadataObject.ObjectType] {
        switch scan {
        case "qr":
            return [.qr]
        case "barcode":
            return [.ean13, .ean8, .code128, .code39, .upce, .pdf417, .interleaved2of5]
        default: // "all"
            return [.qr, .ean13, .ean8, .code128, .code39, .upce, .pdf417, .interleaved2of5, .dataMatrix, .aztec]
        }
    }

    // MARK: - Format name helper (mirrors Android BarcodeDetector.formatName)

    static func formatName(_ type: AVMetadataObject.ObjectType) -> String {
        switch type {
        case .qr:               return "QR"
        case .ean13:            return "EAN_13"
        case .ean8:             return "EAN_8"
        case .code128:          return "CODE_128"
        case .code39:           return "CODE_39"
        case .upce:             return "UPC_E"
        case .pdf417:           return "PDF417"
        case .dataMatrix:       return "DATA_MATRIX"
        case .aztec:            return "AZTEC"
        case .interleaved2of5:  return "ITF"
        default:                return "UNKNOWN"
        }
    }
}

// MARK: - AVCaptureMetadataOutputObjectsDelegate

extension BarcodeDetector: AVCaptureMetadataOutputObjectsDelegate {
    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard !suppressResults else { return }

        for obj in metadataObjects {
            guard let machineReadable = obj as? AVMetadataMachineReadableCodeObject,
                  let value = machineReadable.stringValue else { continue }

            // Transform bounding box from metadata coordinates into preview layer bounds
            let bounds: CGRect
            if let transformed = previewLayer?.transformedMetadataObject(for: machineReadable) {
                bounds = transformed.bounds
            } else {
                bounds = .zero
            }

            detectionHandler?(value, machineReadable.type, bounds)
        }
    }
}
