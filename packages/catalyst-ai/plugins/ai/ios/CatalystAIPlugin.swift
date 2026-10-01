//
//  CatalystAIPlugin.swift
//  catalyst-ai (iOS)
//
//  Entry point the iOS build registers in GeneratedPluginIndex (see manifest.json). JS reaches it via
//  PluginBridge.emit({ pluginId: "io.catalyst.ai", command, data }); results come back as plugin
//  callbacks named like Android's WebBridge events (ON_AI_READY / ON_AI_PROGRESS / ON_AI_LOG / ON_AI_ERROR).
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
/// BridgeUtils.notifyWeb* and FrameworkServerUtils. Payload keys match Android's.
final class PluginAICallbacks: AIBridgeCallbacks {
    private let bridge: PluginBridgeContext

    init(bridge: PluginBridgeContext) {
        self.bridge = bridge
    }

    func onReady(streamUrl: String, port: Int, sessionId: String, engine: String) {
        bridge.callback(eventName: "ON_AI_READY", data: [
            "url": streamUrl, "port": port, "sessionId": sessionId, "engine": engine,
        ])
    }

    func onProgress(phase: String, percent: Int, bytesLoaded: Int64, bytesTotal: Int64, detail: String) {
        bridge.callback(eventName: "ON_AI_PROGRESS", data: [
            "phase": phase, "percent": percent, "bytesLoaded": bytesLoaded, "bytesTotal": bytesTotal, "detail": detail,
        ])
    }

    func onLog(_ message: String) {
        bridge.callback(eventName: "ON_AI_LOG", data: ["message": message])
    }

    func onError(_ message: String, code: String) {
        bridge.callback(eventName: "ON_AI_ERROR", data: ["message": message, "code": code])
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
}
