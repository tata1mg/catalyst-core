import Foundation

/// What the app itself may do with a capture device. Independent of AVFoundation so it can be tested anywhere.
public enum MediaAuthorization: Equatable {
    case notDetermined
    case denied
    case authorized
}

/// What a web page is asking to capture (mirrors WKMediaCaptureType).
public enum MediaCaptureKind: Equatable {
    case camera
    case microphone
    case cameraAndMicrophone
}

/// How the web view answers a capture request.
public enum MediaCaptureDecision: Equatable {
    case grant
    case deny
    /// Leave it to WebKit, which shows the system prompt.
    case prompt
}

/// Which web capture requests the web view may grant, and the status strings the page is told. The Android shell makes
/// the same decision in WebPermissionPolicy, and both answer the page with "GRANTED" or "DENIED" on
/// MICROPHONE_PERMISSION_STATUS.
///
/// The page asks for the microphone through the bridge first (requestMicrophonePermission), so by the time
/// getUserMedia runs the app already holds it and the request is granted without a second prompt. Camera-only requests
/// are left exactly as they were (WebKit decides), so this adds microphone support without changing camera behaviour.
public enum MediaPermissionPolicy {

    public static func decision(
        for kind: MediaCaptureKind,
        camera: MediaAuthorization,
        microphone: MediaAuthorization
    ) -> MediaCaptureDecision {
        let needed: [MediaAuthorization]
        switch kind {
        case .camera:
            return .prompt
        case .microphone:
            needed = [microphone]
        case .cameraAndMicrophone:
            needed = [camera, microphone]
        }
        if needed.contains(.denied) { return .deny }
        if needed.allSatisfy({ $0 == .authorized }) { return .grant }
        return .prompt
    }

    /// The value the page receives: "GRANTED" only when the app holds the permission.
    public static func statusString(for authorization: MediaAuthorization) -> String {
        authorization == .authorized ? "GRANTED" : "DENIED"
    }

    public static func statusString(granted: Bool) -> String {
        granted ? "GRANTED" : "DENIED"
    }
}
