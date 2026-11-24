import XCTest
@testable import CatalystCoreLogic

/// Which web capture requests the web view may grant. Mirrors Android's WebPermissionPolicyTest.
final class MediaPermissionPolicyTests: XCTestCase {

    private func decide(
        _ kind: MediaCaptureKind,
        camera: MediaAuthorization,
        microphone: MediaAuthorization
    ) -> MediaCaptureDecision {
        MediaPermissionPolicy.decision(for: kind, camera: camera, microphone: microphone)
    }

    func testMicrophoneIsGrantedWhenTheAppHoldsIt() {
        XCTAssertEqual(decide(.microphone, camera: .notDetermined, microphone: .authorized), .grant)
    }

    func testMicrophoneIsDeniedWhenTheUserRefusedIt() {
        XCTAssertEqual(decide(.microphone, camera: .authorized, microphone: .denied), .deny)
    }

    func testMicrophoneNotYetAskedLeavesItToTheSystemPrompt() {
        XCTAssertEqual(decide(.microphone, camera: .authorized, microphone: .notDetermined), .prompt)
    }

    func testCameraAndMicrophoneNeedBothBeforeItIsGranted() {
        XCTAssertEqual(decide(.cameraAndMicrophone, camera: .authorized, microphone: .authorized), .grant)
        XCTAssertEqual(decide(.cameraAndMicrophone, camera: .authorized, microphone: .notDetermined), .prompt)
        XCTAssertEqual(decide(.cameraAndMicrophone, camera: .notDetermined, microphone: .authorized), .prompt)
    }

    func testCameraAndMicrophoneIsDeniedWhenEitherWasRefused() {
        XCTAssertEqual(decide(.cameraAndMicrophone, camera: .denied, microphone: .authorized), .deny)
        XCTAssertEqual(decide(.cameraAndMicrophone, camera: .authorized, microphone: .denied), .deny)
    }

    func testCameraOnlyRequestsAreLeftToWebKitWhateverTheMicrophoneState() {
        for camera in [MediaAuthorization.notDetermined, .denied, .authorized] {
            for microphone in [MediaAuthorization.notDetermined, .denied, .authorized] {
                XCTAssertEqual(decide(.camera, camera: camera, microphone: microphone), .prompt)
            }
        }
    }

    func testStatusStringsMatchWhatTheAndroidShellSends() {
        XCTAssertEqual(MediaPermissionPolicy.statusString(for: .authorized), "GRANTED")
        XCTAssertEqual(MediaPermissionPolicy.statusString(for: .denied), "DENIED")
        XCTAssertEqual(MediaPermissionPolicy.statusString(for: .notDetermined), "DENIED")
        XCTAssertEqual(MediaPermissionPolicy.statusString(granted: true), "GRANTED")
        XCTAssertEqual(MediaPermissionPolicy.statusString(granted: false), "DENIED")
    }

    // MARK: - origin trust

    private let app = URL(string: "https://app.example.com/home")

    func testTheAppsOwnOriginIsTrustedWhateverThePathCaseOrDefaultPort() {
        XCTAssertTrue(MediaPermissionPolicy.isTrustedOrigin(origin: URL(string: "https://app.example.com"), appURL: app, whitelisted: false))
        XCTAssertTrue(MediaPermissionPolicy.isTrustedOrigin(origin: URL(string: "https://APP.example.com:443/x?y=1"), appURL: app, whitelisted: false))
    }

    func testAnotherHostSchemeOrPortIsNotTrusted() {
        for other in ["https://evil.example.org", "http://app.example.com", "https://app.example.com:8443", "https://app.example.com.evil.org"] {
            XCTAssertFalse(MediaPermissionPolicy.isTrustedOrigin(origin: URL(string: other), appURL: app, whitelisted: false), other)
        }
    }

    func testAMissingOrNonWebOriginIsNeverTrusted() {
        XCTAssertFalse(MediaPermissionPolicy.isTrustedOrigin(origin: nil, appURL: app, whitelisted: true))
        XCTAssertFalse(MediaPermissionPolicy.isTrustedOrigin(origin: URL(string: "file:///tmp/index.html"), appURL: app, whitelisted: true))
    }

    func testAWhitelistedOriginIsTrustedButOnlyWhenTheCallerSaysSo() {
        let other = URL(string: "https://partner.example.net")
        XCTAssertTrue(MediaPermissionPolicy.isTrustedOrigin(origin: other, appURL: app, whitelisted: true))
        XCTAssertFalse(MediaPermissionPolicy.isTrustedOrigin(origin: other, appURL: app, whitelisted: false))
    }

    func testWithoutAnAppURLOnlyTheWhitelistCanTrustAnOrigin() {
        let page = URL(string: "https://app.example.com")
        XCTAssertFalse(MediaPermissionPolicy.isTrustedOrigin(origin: page, appURL: nil, whitelisted: false))
        XCTAssertTrue(MediaPermissionPolicy.isTrustedOrigin(origin: page, appURL: nil, whitelisted: true))
    }
}
