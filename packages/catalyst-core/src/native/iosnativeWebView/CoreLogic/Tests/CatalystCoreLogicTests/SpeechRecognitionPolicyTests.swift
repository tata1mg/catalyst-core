import XCTest
@testable import CatalystCoreLogic

/// The pure side of the speech recognition bridge. Mirrors Android's SpeechRecognitionUtilsTest.
final class SpeechRecognitionPolicyTests: XCTestCase {

    typealias Policy = SpeechRecognitionPolicy

    private func refusal(
        exists: Bool = true,
        available: Bool = true,
        onDevice: Bool = true,
        _ authorization: SpeechAuthorization = .authorized
    ) -> String? {
        Policy.refusal(
            recognizerExists: exists,
            available: available,
            supportsOnDevice: onDevice,
            authorization: authorization
        )
    }

    func testParseLanguageReadsTheRequestedLanguage() {
        XCTAssertEqual(Policy.parseLanguage(#"{"language":"en-IN"}"#), "en-IN")
    }

    func testParseLanguageDefaultsWhenThereIsNoneOrItIsNotJSON() {
        for config in [nil, "", "   ", "{}", #"{"language":"  "}"#, "not json", #"{"language":5}"#] as [String?] {
            XCTAssertEqual(Policy.parseLanguage(config), "en-US", "config: \(config ?? "nil")")
        }
    }

    func testRefusalIsNilWhenEverythingIsInPlace() {
        XCTAssertNil(refusal(.authorized))
        XCTAssertNil(refusal(.notDetermined))
    }

    func testRefusalNeverFallsBackToServerRecognition() {
        XCTAssertEqual(refusal(onDevice: false), "ON_DEVICE_UNAVAILABLE")
        XCTAssertEqual(refusal(available: false), "ON_DEVICE_UNAVAILABLE")
    }

    func testRefusalPutsAMissingLanguageBeforeAMissingPermission() {
        XCTAssertEqual(refusal(exists: false, available: false, onDevice: false, .denied), "LANGUAGE_UNAVAILABLE")
        XCTAssertEqual(refusal(.denied), "PERMISSION_DENIED")
    }

    func testErrorCodesMapToTheSharedOnes() {
        XCTAssertEqual(Policy.errorCode(domain: "kLSRErrorDomain", code: 301), "CANCELLED")
        XCTAssertEqual(Policy.errorCode(domain: "kAFAssistantErrorDomain", code: 1110), "NO_SPEECH")
        XCTAssertEqual(Policy.errorCode(domain: "kAFAssistantErrorDomain", code: 999_999), "UNKNOWN")
        XCTAssertEqual(Policy.errorCode(domain: "SomethingElse", code: 301), "UNKNOWN")
    }

    func testAMissingOnDeviceModelIsOnDeviceUnavailableNotUnknown() {
        func code(_ domain: String, _ number: Int, _ message: String) -> String {
            Policy.errorCode(domain: domain, code: number, message: message)
        }
        let domain = "kAFAssistantErrorDomain"
        let missing = "Failed to initialize recognizer"
        XCTAssertEqual(code(domain, 1, missing), "ON_DEVICE_UNAVAILABLE")
        XCTAssertEqual(code("x", 2, "Failed to access assets"), "ON_DEVICE_UNAVAILABLE")
        XCTAssertEqual(code("x", 3, "FAILED TO CREATE RECOGNIZER"), "ON_DEVICE_UNAVAILABLE")
        // known domain and code still win over the text, and an unrelated message stays UNKNOWN
        XCTAssertEqual(code(domain, 1110, missing), "NO_SPEECH")
        XCTAssertEqual(code("x", 4, "something else"), "UNKNOWN")
    }

    func testErrorMessagePutsTheDomainAndCodeInFront() {
        XCTAssertEqual(
            Policy.errorMessage(domain: "kAFAssistantErrorDomain", code: 1101, description: "boom"),
            "kAFAssistantErrorDomain 1101: boom"
        )
    }

    func testTheSharedCodesAreTheStringsTheAndroidShellSends() {
        XCTAssertEqual(
            [Policy.Code.onDeviceUnavailable, Policy.Code.languageUnavailable, Policy.Code.permissionDenied,
             Policy.Code.noSpeech, Policy.Code.audio, Policy.Code.busy, Policy.Code.cancelled, Policy.Code.unknown],
            ["ON_DEVICE_UNAVAILABLE", "LANGUAGE_UNAVAILABLE", "PERMISSION_DENIED", "NO_SPEECH", "AUDIO", "BUSY",
             "CANCELLED", "UNKNOWN"]
        )
    }

    func testPayloadsHaveTheSameKeysAsAndroid() {
        XCTAssertEqual(Policy.textPayload("hello")["text"] as? String, "hello")
        XCTAssertEqual(Policy.statePayload("listening")["state"] as? String, "listening")
        let error = Policy.errorPayload(code: "NO_SPEECH", message: "nothing heard")
        XCTAssertEqual(error["code"] as? String, "NO_SPEECH")
        XCTAssertEqual(error["message"] as? String, "nothing heard")

        let supported = Policy.supportPayload(available: true, language: "en-US", installed: true)
        XCTAssertEqual(supported["available"] as? Bool, true)
        XCTAssertEqual(supported["onDevice"] as? Bool, true)
        XCTAssertEqual(supported["installed"] as? Bool, true)
        XCTAssertNil(supported["reason"])

        let refused = Policy.supportPayload(available: false, language: "hi-IN", reason: "ON_DEVICE_UNAVAILABLE")
        XCTAssertEqual(refused["available"] as? Bool, false)
        XCTAssertEqual(refused["onDevice"] as? Bool, false)
        XCTAssertEqual(refused["reason"] as? String, "ON_DEVICE_UNAVAILABLE")
        XCTAssertNil(refused["installed"])
    }
}
