import SwiftUI
import UIKit
import AVFoundation

/// UIViewRepresentable that hosts the camera preview layer.
/// Placed at ZStack index 0 (behind WebViewContainer).
/// The preview layer is managed by CameraSessionManager — this view just
/// provides the UIView container that CameraSessionManager embeds into.
public struct CameraPreviewView: UIViewRepresentable {

    public let cameraManager: NativeCameraManager

    public init(cameraManager: NativeCameraManager) {
        self.cameraManager = cameraManager
    }

    public func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        cameraManager.setPreviewView(view)

        // Pinch gesture for zoom
        let pinch = UIPinchGestureRecognizer(target: context.coordinator,
                                             action: #selector(Coordinator.handlePinch(_:)))
        view.addGestureRecognizer(pinch)
        return view
    }

    public func updateUIView(_ uiView: UIView, context: Context) {
        // Keep preview layer frame in sync when SwiftUI resizes the view
        DispatchQueue.main.async {
            uiView.layer.sublayers?
                .compactMap { $0 as? AVCaptureVideoPreviewLayer }
                .forEach { $0.frame = uiView.bounds }
        }
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(cameraManager: cameraManager)
    }

    public class Coordinator: NSObject {
        private let cameraManager: NativeCameraManager

        public init(cameraManager: NativeCameraManager) {
            self.cameraManager = cameraManager
        }

        @objc func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
            switch recognizer.state {
            case .began:
                cameraManager.handlePinchBegan()
            case .changed:
                cameraManager.handlePinchChanged(scale: recognizer.scale)
            default:
                break
            }
        }
    }
}
