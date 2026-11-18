import Foundation

/// What the user has allowed for speech recognition (SFSpeechRecognizer.authorizationStatus), independent of the Speech
/// framework so it can be tested anywhere.
public enum SpeechAuthorization: Equatable {
    case notDetermined
    case denied
    case authorized
}

/// The pure side of the speech recognition bridge: options, error codes and event payloads. The Android shell sends the
/// same codes and the same payload shapes (SpeechRecognitionUtils), and both recognise on the device only.
public enum SpeechRecognitionPolicy {

    public static let defaultLanguage = "en-US"

    /// Codes the page sees in SPEECH_RECOGNITION_ERROR, identical on Android and iOS.
    public enum Code {
        public static let onDeviceUnavailable = "ON_DEVICE_UNAVAILABLE"
        public static let languageUnavailable = "LANGUAGE_UNAVAILABLE"
        public static let permissionDenied = "PERMISSION_DENIED"
        public static let noSpeech = "NO_SPEECH"
        public static let audio = "AUDIO"
        public static let busy = "BUSY"
        public static let cancelled = "CANCELLED"
        public static let unknown = "UNKNOWN"
    }

    /// The language the page asked for ({"language":"en-US"}), or the default when it asked for none.
    public static func parseLanguage(_ config: String?) -> String {
        guard let config = config, !config.trimmingCharacters(in: .whitespaces).isEmpty,
              let data = config.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let language = json["language"] as? String,
              !language.trimmingCharacters(in: .whitespaces).isEmpty
        else { return defaultLanguage }
        return language
    }

    /// Why recognition cannot start, or nil when it can. Order matters: a missing locale model beats a missing
    /// permission, because asking for permission first would be pointless.
    public static func refusal(
        recognizerExists: Bool,
        available: Bool,
        supportsOnDevice: Bool,
        authorization: SpeechAuthorization
    ) -> String? {
        if !recognizerExists { return Code.languageUnavailable }
        if !supportsOnDevice { return Code.onDeviceUnavailable }
        if !available { return Code.onDeviceUnavailable }
        if authorization == .denied { return Code.permissionDenied }
        return nil
    }

    /// A recognition task's error to a shared code. These domain and code values were seen from the Speech framework
    /// and are not documented; anything unlisted is UNKNOWN.
    ///
    /// A recognizer that cannot be created because its on-device model is missing is reported by message only. The
    /// iOS Simulator does this: `supportsOnDeviceRecognition` is true for en-US, yet the model files are not there and
    /// the task fails with "Failed to initialize recognizer". That is ON_DEVICE_UNAVAILABLE, never a reason to fall
    /// back to a server.
    public static func errorCode(domain: String, code: Int, message: String = "") -> String {
        switch (domain, code) {
        case ("kLSRErrorDomain", 301), ("kAFAssistantErrorDomain", 216), ("kAFAssistantErrorDomain", 1101):
            return Code.cancelled
        case ("kAFAssistantErrorDomain", 1110), ("kLSRErrorDomain", 1110):
            return Code.noSpeech
        default:
            let text = message.lowercased()
            if text.contains("initialize recognizer") || text.contains("access assets")
                || text.contains("failed to create recognizer") {
                return Code.onDeviceUnavailable
            }
            return Code.unknown
        }
    }

    /// The message the page gets with an error: Apple's text with the domain and code in front, so an unfamiliar
    /// failure can be looked up.
    public static func errorMessage(domain: String, code: Int, description: String) -> String {
        "\(domain) \(code): \(description)"
    }

    // MARK: Payloads (the same keys the Android shell sends)

    public static func textPayload(_ text: String) -> [String: Any] { ["text": text] }

    public static func statePayload(_ state: String) -> [String: Any] { ["state": state] }

    public static func errorPayload(code: String, message: String) -> [String: Any] {
        ["code": code, "message": message]
    }

    /// { available, onDevice, language, installed?, reason? }; `installed` is whether the language's model is on the
    /// device.
    public static func supportPayload(
        available: Bool,
        language: String,
        installed: Bool? = nil,
        reason: String? = nil
    ) -> [String: Any] {
        var payload: [String: Any] = ["available": available, "onDevice": available, "language": language]
        if let installed = installed { payload["installed"] = installed }
        if let reason = reason { payload["reason"] = reason }
        return payload
    }
}
