import XCTest
@testable import CatalystCoreLogic

final class ShellCapabilitiesTests: XCTestCase {
    func testScriptDeclaresEveryCapabilityAsTrue() {
        let script = ShellCapabilities.scriptSource
        XCTAssertTrue(script.hasPrefix("window.CatalystShell = "))
        XCTAssertTrue(script.contains("\"microphonePermission\":true"))
        XCTAssertTrue(script.contains("\"speechRecognition\":true"))
    }

    func testScriptIsValidJSONAfterTheAssignment() throws {
        let script = ShellCapabilities.scriptSource
        let json = String(script.dropFirst("window.CatalystShell = ".count).dropLast())
        let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: [String: Bool]]
        XCTAssertEqual(object?["capabilities"]?.count, ShellCapabilities.names.count)
    }
}
