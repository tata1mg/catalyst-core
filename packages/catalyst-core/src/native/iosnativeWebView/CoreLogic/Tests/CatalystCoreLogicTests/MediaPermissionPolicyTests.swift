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
}
