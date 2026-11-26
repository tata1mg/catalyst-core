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

    /// Whether the page that asked may use a capture device at all. Holding the permission app-wide is not enough: the
    /// page must be the app's own, by exact scheme, host and effective port. The access-control whitelist is deliberately
    /// not consulted, because its rules match substrings and prefixes ("https://allowed.example.evil.example" would pass a
    /// rule for "https://allowed.example"). Fails closed: no origin, no app URL or a non-http(s) one is never trusted.
    /// Android makes the same call in WebPermissionPolicy.isTrustedOrigin.
    public static func isTrustedOrigin(origin: URL?, appURL: URL?) -> Bool {
        guard let requesting = PluginBridgeOriginPolicy.normalizedOrigin(of: origin),
              let app = PluginBridgeOriginPolicy.normalizedOrigin(of: appURL) else { return false }
        return requesting == app
    }

    /// The value the page receives: "GRANTED" only when the app holds the permission.
    public static func statusString(for authorization: MediaAuthorization) -> String {
        authorization == .authorized ? "GRANTED" : "DENIED"
    }

    public static func statusString(granted: Bool) -> String {
        granted ? "GRANTED" : "DENIED"
    }
}
