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
        bridge = PluginBridge(webView: mockWebView, viewController: mockViewController, trustedOrigin: PluginMockScriptMessage.appURL)
        bridge.register()
    }

    @MainActor
    func testRegister_InjectsPluginManifestAtDocumentStart() throws {
        let scripts = mockWebView.configuration.userContentController.userScripts
        let manifest = try XCTUnwrap(scripts.first { $0.source.hasPrefix("window.CatalystPlugins = ") })
        XCTAssertEqual(manifest.injectionTime, .atDocumentStart)
        XCTAssertTrue(manifest.isForMainFrameOnly)
    }

    func testPluginManifestScript_ListsPluginsWithSortedCommands() {
        let script = PluginBridge.pluginManifestScript([
            "io.catalyst.ai": ["initAI", "clearConversation"],
            "io.catalyst.device_info": ["getDeviceInfo"],
        ])
        XCTAssertEqual(
            script.source,
            #"window.CatalystPlugins = {"io.catalyst.ai":["clearConversation","initAI"],"io.catalyst.device_info":["getDeviceInfo"]};"#
        )
    }

    func testPluginManifestScript_NoPlugins_DefinesEmptyObject() {
        XCTAssertEqual(PluginBridge.pluginManifestScript([:]).source, "window.CatalystPlugins = {};")
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

    // MARK: - Origin check (#521)

    /// A valid command from `sourceURL`/`isMainFrame`; returns whether the bridge answered at all.
    @MainActor
    private func bridgeAnswers(sourceURL: URL?, isMainFrame: Bool = true, trusted: URL? = PluginMockScriptMessage.appURL) async -> Bool {
        let local = PluginBridge(webView: mockWebView, viewController: mockViewController, trustedOrigin: trusted)
        mockWebView.evaluatedScripts.removeAll()
        // An unknown plugin is the cheapest observable reply: trusted senders get PLUGIN_NOT_FOUND back.
        local.handleMessage(PluginMockScriptMessage(
            name: "PluginBridge",
            body: ["pluginId": "missing-plugin", "command": "ping"],
            isMainFrame: isMainFrame,
            sourceURL: sourceURL
        ))
        try? await Task.sleep(nanoseconds: 300_000_000)
        return mockWebView.evaluatedScripts.contains { $0.contains("PLUGIN_NOT_FOUND") }
    }

    @MainActor
    func testOrigin_AppMainFrame_IsServed() async {
        let answered = await bridgeAnswers(sourceURL: URL(string: "https://app.example.com/some/page"))
        XCTAssertTrue(answered)
    }

    @MainActor
    func testOrigin_OtherSite_IsDroppedSilently() async {
        let answered = await bridgeAnswers(sourceURL: URL(string: "https://evil.example.net/"))
        XCTAssertFalse(answered, "an untrusted page must get no reply, not even an error")
    }

    @MainActor
    func testOrigin_SameOriginSubframe_IsDropped() async {
        let answered = await bridgeAnswers(sourceURL: PluginMockScriptMessage.appURL, isMainFrame: false)
        XCTAssertFalse(answered)
    }

    @MainActor
    func testOrigin_MissingSourceOrTrustedOrigin_FailsClosed() async {
        let noSource = await bridgeAnswers(sourceURL: nil)
        XCTAssertFalse(noSource)
        let noTrusted = await bridgeAnswers(sourceURL: PluginMockScriptMessage.appURL, trusted: nil)
        XCTAssertFalse(noTrusted)
    }


    // MARK: - Origin check against a real WKWebView

    /// Loads `html` as if served from `baseURL` in a real WKWebView wired to a real PluginBridge, and reports whether
    /// the bridge replied to the page's postMessage (the page forwards any PluginBridgeWeb.dispatch to a probe handler).
    @MainActor
    private func realPageGetsReply(baseURL: String, subframe: Bool) async -> Bool {
        let probe = ProbeHandler()
        let config = WKWebViewConfiguration()
        config.userContentController.add(probe, name: "probe")
        let webView = WKWebView(frame: .zero, configuration: config)
        let realBridge = PluginBridge(webView: webView, viewController: UIViewController(), trustedOrigin: PluginMockScriptMessage.appURL)
        realBridge.register()
        defer { realBridge.unregister(); config.userContentController.removeScriptMessageHandler(forName: "probe") }

        let post = "window.webkit.messageHandlers.PluginBridge.postMessage({pluginId:'missing-plugin',command:'ping'})"
        let inner = subframe ? "<iframe srcdoc=\"<script>\(post)</script>\"></iframe>" : "<script>\(post)</script>"
        let html = "<html><body><script>window.PluginBridgeWeb={dispatch:function(e){window.webkit.messageHandlers.probe.postMessage(e)}}</script>\(inner)</body></html>"
        webView.loadHTMLString(html, baseURL: URL(string: baseURL))

        for _ in 0..<30 {
            if probe.received { return true }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return false
    }

    @MainActor
    func testRealWebView_AppOriginMainFrame_GetsReply() async {
        let replied = await realPageGetsReply(baseURL: "https://app.example.com/", subframe: false)
        XCTAssertTrue(replied)
    }

    @MainActor
    func testRealWebView_OtherOrigin_GetsNoReply() async {
        let replied = await realPageGetsReply(baseURL: "https://evil.example.net/", subframe: false)
        XCTAssertFalse(replied)
    }

    @MainActor
    func testRealWebView_SameOriginIframe_GetsNoReply() async {
        let replied = await realPageGetsReply(baseURL: "https://app.example.com/", subframe: true)
        XCTAssertFalse(replied)
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
    func testCallbackHandling_ArbitraryCallback_DispatchesPluginEnvelope() async {
        testExpectation = expectation(description: "Arbitrary callback should dispatch plugin envelope")
        mockWebView.onEvaluateJavaScript = { script in
            if script.contains("PluginBridgeWeb.dispatch") &&
                script.contains("sync-plugin") &&
                script.contains("ON_FAILURE") &&
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
            requestId: "req-9"
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
            requestId: "req-10"
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
    static let appURL = URL(string: "https://app.example.com/")!

    let name: String
    let body: Any
    var isMainFrame = true
    var sourceURL: URL? = PluginMockScriptMessage.appURL
}

private final class ProbeHandler: NSObject, WKScriptMessageHandler {
    private(set) var received = false
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        received = true
    }
}
