//
//  CatalystAIPlugin.swift
//  catalyst-ai (iOS)
//
//  Entry point the iOS build registers in GeneratedPluginIndex (see manifest.json). JS reaches it via
//  the PluginBridge message handler ({ pluginId: "io.catalyst.ai", command, data }); results come back
//  as the same WebBridge events Android emits (ON_AI_READY / ON_AI_PROGRESS / ON_AI_LOG / ON_AI_ERROR).
//
//  PluginBridge builds a fresh plugin object per command, so all state lives in CatalystAIBridge.shared.
//

import Foundation
import CatalystCoreLogic

final class CatalystAIPlugin: CatalystPlugin {
    static let pluginId = "io.catalyst.ai"

    func handle(command: String, data: Any?, bridge: PluginBridgeContext) {
        let ai = CatalystAIBridge.shared
        switch command {
        case "initAI":
            ai.attach(callbacks: PluginAICallbacks(bridge: bridge))
            ai.initAI(optionsRaw: Self.optionsString(from: data))
        case "clearConversation":
            ai.clearConversation()
        default:
            bridge.callback(eventName: "ON_AI_ERROR", data: [
                "message": "Unsupported command: \(command)",
                "code": "COMMAND_NOT_SUPPORTED",
            ])
        }
    }

    /// Android passes a JSON string to initAI; PluginBridge delivers `data` already decoded.
    private static func optionsString(from data: Any?) -> String? {
        if let string = data as? String { return string }
        guard let object = data as? [String: Any],
              JSONSerialization.isValidJSONObject(object),
              let json = try? JSONSerialization.data(withJSONObject: object) else { return nil }
        return String(data: json, encoding: .utf8)
    }
}

/// Kotlin equivalent: the Proxy handler in NativeBridge.kt that forwards AIBridgeCallbacks to
/// BridgeUtils.notifyWeb* and FrameworkServerUtils. Events go out through the same
/// `window.WebBridge.callback(event, payload)` channel Android uses, with the same payload keys,
/// so useNativeAI registers one set of ON_AI_* handlers for both platforms.
final class PluginAICallbacks: AIBridgeCallbacks {
    private let bridge: PluginBridgeContext

    init(bridge: PluginBridgeContext) {
        self.bridge = bridge
    }

    func onReady(streamUrl: String, port: Int, sessionId: String, engine: String) {
        emit("ON_AI_READY", ["url": streamUrl, "port": port, "sessionId": sessionId, "engine": engine])
    }

    func onProgress(phase: String, percent: Int, bytesLoaded: Int64, bytesTotal: Int64, detail: String) {
        emit("ON_AI_PROGRESS", ["phase": phase, "percent": percent, "bytesLoaded": bytesLoaded, "bytesTotal": bytesTotal, "detail": detail])
    }

    func onLog(_ message: String) {
        emit("ON_AI_LOG", ["message": message])
    }

    func onError(_ message: String, code: String) {
        emit("ON_AI_ERROR", ["message": message, "code": code])
    }

    func ensureFrameworkServerRunning() -> Bool {
        FrameworkServerUtils.shared.isRunning() || FrameworkServerUtils.shared.startServer()
    }

    func getFrameworkServerPort() -> Int { Int(FrameworkServerUtils.shared.getServerPort()) }
    func getFrameworkServerSessionId() -> String { FrameworkServerUtils.shared.getSessionId() }
    func getNativeAIStreamURL() -> String? { FrameworkServerUtils.shared.nativeAIStreamURL() }

    func setNativeAiSupplier(_ supplier: NativeAISupplier?) {
        FrameworkServerUtils.shared.setNativeAiSupplier(supplier)
    }

    func setNativeSystemPrompt(_ prompt: String) {
        FrameworkServerUtils.shared.setNativeSystemPrompt(prompt)
    }

    /// Same wire format as BridgeJavaScriptInterface.sendJSONCallback: the payload is serialized with
    /// JSONSerialization (never string-built), so model/log text cannot break out of the script.
    private func emit(_ eventName: String, _ payload: [String: Any]) {
        guard let webView = bridge.webView,
              JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = "window.WebBridge && window.WebBridge.callback('\(eventName)', \(json))"
        DispatchQueue.main.async {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
