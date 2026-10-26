//
//  AIBridge.swift
//  catalyst-ai (iOS)
//
//  Kotlin equivalent: AIBridge.kt (AIBridge + AIBridgeCallbacks). The callbacks decouple this module
//  from catalyst-core internals: the plugin entry point implements them over PluginBridgeContext and
//  the framework server, and nothing else in this module touches either.
//

import Foundation
import CatalystCoreLogic

protocol AIBridge: AnyObject {
    func attach(callbacks: AIBridgeCallbacks)
    func initAI(optionsRaw: String?)
    func clearConversation()
}

protocol AIBridgeCallbacks: AnyObject {
    func onReady(streamUrl: String, port: Int, sessionId: String, engine: String)
    func onProgress(phase: String, percent: Int, bytesLoaded: Int64, bytesTotal: Int64, detail: String)
    func onLog(_ message: String)
    func onError(_ message: String, code: String)
    /// Starts the framework server if needed (iOS lazily starts it for files too); false if it cannot run.
    func ensureFrameworkServerRunning() -> Bool
    func getFrameworkServerPort() -> Int
    func getFrameworkServerSessionId() -> String
    func getNativeAIStreamURL() -> String?
    func setNativeAiSupplier(_ supplier: NativeAISupplier?)
    func setNativeSystemPrompt(_ prompt: String)
}

/// Shared by both engines. Kotlin equivalent: NativeBridgeAI's constructor callbacks.
typealias AILogHandler = (String) -> Void
typealias AIProgressHandler = (_ phase: String, _ percent: Int, _ bytesLoaded: Int64, _ bytesTotal: Int64, _ detail: String) -> Void

protocol NativeAIEngine: AnyObject {
    var kind: EngineKind { get }
    /// Prompt the framework server prepends to each request (Android's behaviour). Engines that take
    /// instructions natively (Foundation Models) return "" and keep the prompt in their own session.
    var serverSystemPrompt: String { get }
    func prepare(options: AIOptions) async throws
    func supply(prompt: String, genConfig: [String: Any], conversationId: String?) async throws -> NativeAIStream
    func clearConversation()
}
