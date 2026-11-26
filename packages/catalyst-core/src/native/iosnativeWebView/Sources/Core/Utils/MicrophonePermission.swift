import AVFoundation
import CatalystCoreLogic

/// Microphone permission for the bridge, the iOS counterpart of Android's MicrophoneUtils.
/// The page asks through requestMicrophonePermission before it records, so the web view can grant getUserMedia
/// without a second prompt (see WebViewNavigationDelegate and MediaPermissionPolicy).
enum MicrophonePermission {

    /// What the app itself may do with the microphone right now.
    static func authorization() -> MediaAuthorization {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return .authorized
        case .notDetermined:
            return .notDetermined
        case .denied, .restricted:
            return .denied
        @unknown default:
            return .denied
        }
    }

    /// Resolves true once the app holds the microphone, asking the user first when it has not been asked yet.
    /// Calls back on the main queue.
    static func request(completion: @escaping (Bool) -> Void) {
        switch authorization() {
        case .authorized:
            DispatchQueue.main.async { completion(true) }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        case .denied:
            DispatchQueue.main.async { completion(false) }
        }
    }
}
