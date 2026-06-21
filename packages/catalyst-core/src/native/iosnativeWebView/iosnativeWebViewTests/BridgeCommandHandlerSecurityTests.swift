import XCTest
import WebKit
@testable import CatalystCore

/**
 * Unit tests for BridgeCommandHandler — security commands.
 *
 * Coverage:
 * 1. setScreenSecure routing (3 tests)
 * 2. getScreenSecure routing (2 tests)
 * 3. clearWebData routing (3 tests)
 *
 * Total: 8 tests
 *
 * Each test drives the full bridge pipeline (NativeBridge → BridgeCommandHandler)
 * via a MockWKWebView and captures the evaluateJavaScript call that the delegate
 * would fire back to the web layer.
 *
 * MockWKWebView and MockWKScriptMessage are defined in NativeBridgeTests.swift
 * and BridgeMessageValidatorTests.swift respectively (shared across the test target).
 */
final class BridgeCommandHandlerSecurityTests: XCTestCase {

    var bridge: NativeBridge!
    var mockWebView: MockWKWebView!
    var mockViewController: UIViewController!

    override func setUp() {
        super.setUp()
        mockWebView = MockWKWebView()
        mockViewController = UIViewController()
        bridge = NativeBridge(webView: mockWebView, viewController: mockViewController)
        bridge.register()
        // Ensure a clean screen-secure state before each test
        ScreenSecureManager.shared.setScreenSecure(false)
    }

    override func tearDown() {
        bridge.unregister()
        bridge = nil
        mockWebView = nil
        mockViewController = nil
        ScreenSecureManager.shared.setScreenSecure(false)
        super.tearDown()
    }

    // ============================================================
    // CATEGORY 1: setScreenSecure routing (3 tests)
    // ============================================================

    func testSetScreenSecure_Enable_FiresOnScreenSecureSetCallback() {
        let exp = expectation(description: "ON_SCREEN_SECURE_SET callback fired")

        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("ON_SCREEN_SECURE_SET") {
                exp.fulfill()
            }
        }

        let message = createMessage(command: "setScreenSecure", data: ["enable": true])
        bridge.userContentController(mockWebView.configuration.userContentController,
                                     didReceive: message)

        wait(for: [exp], timeout: 2.0)
    }

    func testSetScreenSecure_Enable_CallbackContainsSecureTrue() {
        let exp = expectation(description: "ON_SCREEN_SECURE_SET payload has secure:true")

        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("ON_SCREEN_SECURE_SET") {
                XCTAssertTrue(
                    script.contains("\"secure\"") || script.contains("secure"),
                    "Callback should include secure field"
                )
                XCTAssertTrue(
                    script.contains("true"),
                    "secure should be true after enabling"
                )
                exp.fulfill()
            }
        }

        let message = createMessage(command: "setScreenSecure", data: ["enable": true])
        bridge.userContentController(mockWebView.configuration.userContentController,
                                     didReceive: message)

        wait(for: [exp], timeout: 2.0)
    }

    func testSetScreenSecure_InvalidParams_FiresErrorCallback() {
        // Passing a non-dict, non-string param is handled by the fallback in
        // BridgeCommandHandler.setScreenSecure — it fires ON_SCREEN_SECURE_ERROR.
        let exp = expectation(description: "ON_SCREEN_SECURE_ERROR fired for nil params")

        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("ON_SCREEN_SECURE_ERROR") {
                exp.fulfill()
            }
        }

        // Route via bridge with data that contains no "enable" key at all
        let message = createMessage(command: "setScreenSecure", data: [:])
        bridge.userContentController(mockWebView.configuration.userContentController,
                                     didReceive: message)

        // The empty dict triggers the else branch → ON_SCREEN_SECURE_ERROR
        wait(for: [exp], timeout: 2.0)
    }

    // ============================================================
    // CATEGORY 2: getScreenSecure routing (2 tests)
    // ============================================================

    func testGetScreenSecure_FiresOnScreenSecureStatusCallback() {
        let exp = expectation(description: "ON_SCREEN_SECURE_STATUS callback fired")

        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("ON_SCREEN_SECURE_STATUS") {
                exp.fulfill()
            }
        }

        let message = createMessage(command: "getScreenSecure", data: [:])
        bridge.userContentController(mockWebView.configuration.userContentController,
                                     didReceive: message)

        wait(for: [exp], timeout: 2.0)
    }

    func testGetScreenSecure_ReflectsCurrentState() {
        // Set state first, then query it via the bridge
        ScreenSecureManager.shared.setScreenSecure(true)

        let exp = expectation(description: "ON_SCREEN_SECURE_STATUS reflects secure:true")

        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("ON_SCREEN_SECURE_STATUS") {
                XCTAssertTrue(script.contains("true"),
                              "Status callback should reflect secure=true")
                exp.fulfill()
            }
        }

        let message = createMessage(command: "getScreenSecure", data: [:])
        bridge.userContentController(mockWebView.configuration.userContentController,
                                     didReceive: message)

        wait(for: [exp], timeout: 2.0)
    }

    // ============================================================
    // CATEGORY 3: clearWebData routing (3 tests)
    // ============================================================

    func testClearWebData_WhenWebViewPresent_FiresOnWebDataClearedCallback() {
        // BridgeCommandHandler needs a webView injected to proceed past the guard
        // NativeBridge injects it during register(), so the mock is already set.
        let exp = expectation(description: "ON_WEB_DATA_CLEARED callback fired")

        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("ON_WEB_DATA_CLEARED") {
                exp.fulfill()
            }
        }

        let message = createMessage(command: "clearWebData", data: [:])
        bridge.userContentController(mockWebView.configuration.userContentController,
                                     didReceive: message)

        // clearWebData is async (WKWebsiteDataStore removal) — allow extra time
        wait(for: [exp], timeout: 5.0)
    }

    func testClearWebData_SuccessPayloadContainsSuccessTrue() {
        let exp = expectation(description: "clearWebData success payload has success:true")

        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("ON_WEB_DATA_CLEARED") {
                XCTAssertTrue(script.contains("true"),
                              "success field should be true in cleared callback")
                exp.fulfill()
            }
        }

        let message = createMessage(command: "clearWebData", data: [:])
        bridge.userContentController(mockWebView.configuration.userContentController,
                                     didReceive: message)

        wait(for: [exp], timeout: 5.0)
    }

    func testClearWebData_CommandAcceptedByValidator() {
        // Validates command reaches the handler without being rejected by BridgeMessageValidator
        let messageBody: [String: Any] = ["command": "clearWebData", "data": [:]]
        let message = MockWKScriptMessage(name: "NativeBridge", body: messageBody)
        let result = BridgeMessageValidator.validate(message: message)

        XCTAssertTrue(result.isValid, "clearWebData should pass BridgeMessageValidator")
        XCTAssertEqual(result.command, "clearWebData")
        XCTAssertNil(result.error)
    }

    // ============================================================
    // Helpers
    // ============================================================

    private func createMessage(command: String, data: [String: Any]) -> WKScriptMessage {
        let body: [String: Any] = ["command": command, "data": data]
        return MockWKScriptMessage(name: "NativeBridge", body: body)
    }
}
