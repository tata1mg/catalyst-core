//
//  NativeAI.swift
//  iosnativeWebView
//
//  Types shared between the framework server's native-AI routes and the AI
//  engine that catalyst-ai plugs in. Mirrors the Kotlin contract in
//  FrameworkServerUtils.kt: an engine hands the server a "supplier" that
//  turns (prompt, genConfig, conversationId) into (conversationId, token stream).
//  catalyst-core has no knowledge of any inference library.
//

import Foundation

/// Result of one native-AI request: the active conversation id plus the token stream.
/// Kotlin equivalent: Pair<String, Flow<String>>.
public typealias NativeAIStream = (conversationId: String, tokens: AsyncThrowingStream<String, Error>)

/// Kotlin equivalent: suspend (String, JSONObject, String?) -> Pair<String, Flow<String>>.
public typealias NativeAISupplier = (
    _ prompt: String,
    _ genConfig: [String: Any],
    _ conversationId: String?
) async throws -> NativeAIStream

/// Error codes come from packages/catalyst-core/src/errors/registry.js (AI-xxx) so the
/// JS side surfaces the same code on iOS and Android.
public enum NativeAIErrorCode {
    public static let invalidRequestBody = "AI-003"
    public static let streamNotReady = "AI-005"
    public static let requestFailed = "AI-006"
}

/// An error an engine/server can raise with the registry code that should reach JS.
public struct NativeAIError: LocalizedError {
    public let message: String
    public let code: String

    public init(message: String, code: String = NativeAIErrorCode.requestFailed) {
        self.message = message
        self.code = code
    }

    public var errorDescription: String? { message }
}

/// Server-Sent Events framing. Frame shapes match Android's /ai/stream exactly:
/// {"conversationId"}, {"token"}, {"done":true}, {"error"} (+ "code" on iOS).
enum NativeAISSE {
    static func frame(_ payload: [String: Any]) -> Data {
        // Payloads are built from Strings/Bools only, so serialization cannot fail;
        // the fallback keeps the stream well-formed regardless.
        let json = (try? JSONSerialization.data(withJSONObject: payload, options: [.withoutEscapingSlashes]))
            ?? Data("{\"error\":\"serialization failed\"}".utf8)
        return Data("data: ".utf8) + json + Data("\n\n".utf8)
    }

    static func conversationId(_ id: String) -> Data { frame(["conversationId": id]) }
    static func token(_ text: String) -> Data { frame(["token": text]) }
    static func done() -> Data { frame(["done": true]) }
    static func error(_ message: String, code: String) -> Data { frame(["error": message, "code": code]) }
}

/// Parsed body of POST /ai/stream and /ai/generate: { prompt, genConfig, conversationId }.
struct NativeAIRequest {
    let prompt: String
    let genConfig: [String: Any]
    let conversationId: String?

    init(body: Data) {
        let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        prompt = object["prompt"] as? String ?? ""
        genConfig = object["genConfig"] as? [String: Any] ?? [:]
        let id = (object["conversationId"] as? String) ?? ""
        conversationId = id.isEmpty ? nil : id
    }
}
