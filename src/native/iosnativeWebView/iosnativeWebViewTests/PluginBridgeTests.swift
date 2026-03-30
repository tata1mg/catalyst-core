import XCTest
import WebKit
import UIKit
@testable import CatalystCore

final class PluginBridgeTests: XCTestCase {

    private var bridge: PluginBridge!
    private var mockWebView: PluginMockWKWebView!
    private var mockViewController: UIViewController!
    private var testExpectation: XCTestExpectation!

    @MainActor
    override func setUp() {
        super.setUp()
        mockWebView = PluginMockWKWebView()
        mockViewController = UIViewController()
        bridge = PluginBridge(webView: mockWebView, viewController: mockViewController)
        bridge.register()
    }

    @MainActor
    override func tearDown() {
        bridge.unregister()
        bridge = nil
        mockWebView = nil
        mockViewController = nil
        testExpectation = nil
        super.tearDown()
    }

    @MainActor
    func testMessageHandling_InvalidHandler_EmitsInvalidPayloadError() async {
        testExpectation = expectation(description: "Invalid handler should emit bridge error")
        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("PLUGIN_BRIDGE_ERROR") && script.contains("INVALID_PAYLOAD") {
                self.testExpectation.fulfill()
            }
        }

        let message = PluginMockScriptMessage(
            name: "NativeBridge",
            body: [
                "pluginId": "device-info-plugin",
                "command": "getDeviceInfo"
            ]
        )

        bridge.handleMessage(message)

        await fulfillment(of: [testExpectation], timeout: 2.0)
    }

    @MainActor
    func testMessageHandling_UnknownPlugin_EmitsPluginNotFoundError() async {
        testExpectation = expectation(description: "Unknown plugin should emit plugin not found error")
        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("PLUGIN_BRIDGE_ERROR") && script.contains("PLUGIN_NOT_FOUND") {
                self.testExpectation.fulfill()
            }
        }

        let message = PluginMockScriptMessage(
            name: "PluginBridge",
            body: [
                "pluginId": "missing-plugin",
                "command": "ping",
                "requestId": "req-42"
            ]
        )

        bridge.handleMessage(message)

        await fulfillment(of: [testExpectation], timeout: 2.0)
    }

    @MainActor
    func testCallbackHandling_UndeclaredCallback_EmitsBridgeErrorEnvelope() async {
        testExpectation = expectation(description: "Undeclared callback should emit bridge error")
        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("PLUGIN_BRIDGE_ERROR") &&
                script.contains("INVALID_CALLBACK") &&
                script.contains("req-9") &&
                script.contains("syncData") {
                self.testExpectation.fulfill()
            }
        }

        let context = PluginBridgeContext(
            webView: mockWebView,
            viewController: mockViewController,
            pluginId: "sync-plugin",
            command: "syncData",
            requestId: "req-9",
            allowedCallbacks: ["ON_SUCCESS"]
        )

        context.callback(eventName: "ON_FAILURE", data: ["reason": "network"])

        await fulfillment(of: [testExpectation], timeout: 2.0)
    }

    @MainActor
    func testCallbackHandling_ValidCallback_DispatchesPluginEnvelope() async {
        testExpectation = expectation(description: "Valid callback should dispatch plugin envelope")
        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("PluginBridgeWeb.dispatch") &&
                script.contains("sync-plugin") &&
                script.contains("ON_SUCCESS") &&
                script.contains("req-10") {
                self.testExpectation.fulfill()
            }
        }

        let context = PluginBridgeContext(
            webView: mockWebView,
            viewController: mockViewController,
            pluginId: "sync-plugin",
            command: "syncData",
            requestId: "req-10",
            allowedCallbacks: ["ON_SUCCESS"]
        )

        context.callback(eventName: "ON_SUCCESS", data: ["status": "ok"])

        await fulfillment(of: [testExpectation], timeout: 2.0)
    }
}

private final class PluginMockWKWebView: WKWebView {
    var onEvaluateJavaScript: ((String) -> Void)?
    var evaluatedScripts: [String] = []

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
    }

    convenience init() {
        let config = WKWebViewConfiguration()
        self.init(frame: .zero, configuration: config)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @MainActor
    override func evaluateJavaScript(_ javaScriptString: String, completionHandler: ((Any?, Error?) -> Void)? = nil) {
        evaluatedScripts.append(javaScriptString)
        onEvaluateJavaScript?(javaScriptString)

        DispatchQueue.main.async {
            completionHandler?(nil, nil)
        }
    }
}

private struct PluginMockScriptMessage: PluginBridgeMessage {
    let name: String
    let body: Any
}
