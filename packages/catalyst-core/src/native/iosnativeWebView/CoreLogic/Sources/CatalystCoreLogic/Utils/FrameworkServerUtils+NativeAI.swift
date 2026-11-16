//
//  FrameworkServerUtils+NativeAI.swift
//  iosnativeWebView
//
//  Native-AI routes (/ai/stream, /ai/generate) and their supplier API, split out of FrameworkServerUtils.swift
//  to keep that file within the lint limits. Kotlin equivalent: the AI routes in startKtorServer().
//

import Foundation
import Network
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "FrameworkServer")

extension FrameworkServerUtils {
    // MARK: - Native AI API

    /// Installs the engine that answers `POST /ai/stream` and `POST /ai/generate`. Each request calls the supplier
    /// with the (system-prompt-prefixed) prompt, the request's `genConfig` and its conversation id. While it is
    /// `nil` (the default, and after passing `nil`) both routes answer "not ready" (`AI-005`) instead of running.
    /// Set by the AI plugin once its engine has loaded.
    public func setNativeAiSupplier(_ supplier: NativeAISupplier?) {
        aiLock.lock(); defer { aiLock.unlock() }
        nativeAiSupplier = supplier
    }

    /// Sets the system prompt the server prepends (as `"<prompt>\n\n<user prompt>"`) to every AI request before it
    /// reaches the supplier. Pass an empty string to prepend nothing, for engines that keep their instructions in
    /// their own session. Read per request, so changes apply to the next one.
    public func setNativeSystemPrompt(_ systemPrompt: String) {
        aiLock.lock(); defer { aiLock.unlock() }
        nativeSystemPrompt = systemPrompt
    }

    /// URL JS posts to for streaming; scheme follows whatever the listener actually runs (HTTP/HTTPS),
    /// built the same way as served-file URLs.
    public func nativeAIStreamURL() -> String? {
        guard isServerRunning else { return nil }
        let scheme = isHTTPS ? "https" : "http"
        return "\(scheme)://localhost:\(serverPort)/framework-\(sessionId)/ai/stream"
    }


    // MARK: - Native AI routes
    // Kotlin equivalent: the post("/ai/stream"), post("/ai/generate") and options(...) routes in
    // startKtorServer(). The engine behind the supplier lives in catalyst-ai, not here.

    private func aiSnapshot() -> (supplier: NativeAISupplier?, systemPrompt: String) {
        aiLock.lock(); defer { aiLock.unlock() }
        return (nativeAiSupplier, nativeSystemPrompt)
    }

    /// The server prepends the engine-provided system prompt, exactly like Android.
    /// Engines that manage their own instructions simply never call setNativeSystemPrompt.
    private func composePrompt(_ request: NativeAIRequest, systemPrompt: String) -> String {
        systemPrompt.isEmpty ? request.prompt : "\(systemPrompt)\n\n\(request.prompt)"
    }

    func sendAIPreflight(on connection: NWConnection) {
        sendHTTPResponse(on: connection, statusCode: 200, body: Data(), headers: [
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Max-Age": "86400",
        ])
    }

    func cancelAIStream(for connection: NWConnection) {
        requestStateLock.lock()
        let task = aiStreamTasks.removeValue(forKey: ObjectIdentifier(connection))
        requestStateLock.unlock()
        task?.cancel()
    }

    /// A client that stops reading must not keep the model running: if a write is not accepted within this long,
    /// the connection is dropped, which fails the send, ends the stream and cancels generation upstream.
    static let aiWriteTimeout: TimeInterval = 30

    private func sendRaw(_ data: Data, on connection: NWConnection) async -> Bool {
        await withCheckedContinuation { continuation in
            let deadline = DispatchWorkItem { connection.cancel() }
            DispatchQueue.global().asyncAfter(deadline: .now() + Self.aiWriteTimeout, execute: deadline)
            connection.send(content: data, completion: .contentProcessed { error in
                deadline.cancel()
                if let error = error {
                    logger.debug("AI stream send failed: \(error.localizedDescription)")
                }
                continuation.resume(returning: error == nil)
            })
        }
    }

    private func sseHeaders() -> Data {
        var head = "HTTP/1.1 200 OK\r\n"
        head += "Access-Control-Allow-Origin: \(allowedOrigin)\r\n"
        head += "Access-Control-Allow-Methods: POST, OPTIONS\r\n"
        head += "Access-Control-Allow-Headers: *\r\n"
        head += "Content-Type: text/event-stream\r\n"
        head += "Cache-Control: no-cache\r\n"
        head += "X-Accel-Buffering: no\r\n"
        head += "Connection: close\r\n"
        head += "\r\n"
        return Data(head.utf8)
    }

    func startAIStream(_ request: NativeAIRequest, on connection: NWConnection) {
        cancelConnectionTimeout(for: connection)
        let key = ObjectIdentifier(connection)

        // Held across Task creation so the task's own cleanup cannot run before it is registered.
        requestStateLock.lock()
        aiStreamTasks[key] = Task { [weak self] in
            guard let self = self else { connection.cancel(); return }
            await self.runAIStream(request, on: connection)
            self.cancelAIStream(for: connection)
            connection.cancel()
        }
        requestStateLock.unlock()
    }

    private func runAIStream(_ request: NativeAIRequest, on connection: NWConnection) async {
        guard await sendRaw(sseHeaders(), on: connection) else { return }

        let (supplier, systemPrompt) = aiSnapshot()
        let prompt = composePrompt(request, systemPrompt: systemPrompt)

        guard let supplier = supplier else {
            _ = await sendRaw(NativeAISSE.error("Native AI not initialised — call initAI() first", code: NativeAIErrorCode.streamNotReady), on: connection)
            return
        }
        guard !request.prompt.isEmpty else {
            _ = await sendRaw(NativeAISSE.error("prompt is empty", code: NativeAIErrorCode.invalidRequestBody), on: connection)
            return
        }

        do {
            let stream = try await supplier(prompt, request.genConfig, request.conversationId)
            guard await sendRaw(NativeAISSE.conversationId(stream.conversationId), on: connection) else { return }
            for try await token in stream.tokens {
                // A failed send means the client disconnected; leaving the loop terminates the
                // token stream, which is what stops generation upstream.
                guard await sendRaw(NativeAISSE.token(token), on: connection) else { return }
            }
            _ = await sendRaw(NativeAISSE.done(), on: connection)
        } catch is CancellationError {
            logger.debug("Native AI stream cancelled (client disconnected)")
        } catch {
            let code = (error as? NativeAIError)?.code ?? NativeAIErrorCode.requestFailed
            logger.error("Native AI stream error [\(code)] conversation=\(request.conversationId ?? "<new>"): \(error.localizedDescription)")
            _ = await sendRaw(NativeAISSE.error(error.localizedDescription, code: code), on: connection)
        }
    }

    private static let aiGenerateTimeout: TimeInterval = 120

    /// Drains the token stream fully, then answers with one JSON body: { output, conversationId, tokenCount }.
    func runAIGenerate(_ request: NativeAIRequest, on connection: NWConnection) {
        cancelConnectionTimeout(for: connection)
        let key = ObjectIdentifier(connection)

        requestStateLock.lock()
        aiStreamTasks[key] = Task { [weak self] in
            guard let self = self else { connection.cancel(); return }
            await self.respondAIGenerate(request, on: connection)
            self.cancelAIStream(for: connection)
        }
        requestStateLock.unlock()
    }

    private func respondAIGenerate(_ request: NativeAIRequest, on connection: NWConnection) async {
        func fail(_ status: Int, _ message: String, _ code: String) {
            let body = (try? JSONSerialization.data(withJSONObject: ["error": message, "code": code])) ?? Data()
            sendHTTPResponse(on: connection, statusCode: status, body: body, headers: ["Content-Type": "application/json"])
        }

        let (supplier, systemPrompt) = aiSnapshot()
        guard let supplier = supplier else {
            fail(503, "Native AI not initialised — call initAI() first", NativeAIErrorCode.streamNotReady)
            return
        }
        guard !request.prompt.isEmpty else {
            fail(400, "prompt is empty", NativeAIErrorCode.invalidRequestBody)
            return
        }

        let prompt = composePrompt(request, systemPrompt: systemPrompt)
        do {
            let result: (output: String, conversationId: String, tokenCount: Int) = try await withThrowingTaskGroup(of: (String, String, Int)?.self) { group in
                group.addTask {
                    let stream = try await supplier(prompt, request.genConfig, request.conversationId)
                    var output = ""
                    var count = 0
                    for try await token in stream.tokens { output += token; count += 1 }
                    return (output, stream.conversationId, count)
                }
                group.addTask {
                    try await Task.sleep(nanoseconds: UInt64(Self.aiGenerateTimeout * 1_000_000_000))
                    return nil
                }
                defer { group.cancelAll() }
                guard let first = try await group.next(), let value = first else {
                    throw NativeAIError(message: "generate timed out after \(Int(Self.aiGenerateTimeout))s")
                }
                return value
            }
            let body = try JSONSerialization.data(withJSONObject: [
                "output": result.output,
                "conversationId": result.conversationId,
                "tokenCount": result.tokenCount,
            ])
            sendHTTPResponse(on: connection, statusCode: 200, body: body, headers: ["Content-Type": "application/json"])
        } catch is CancellationError {
            connection.cancel()
        } catch let error as NativeAIError where error.message.hasPrefix("generate timed out") {
            fail(504, error.message, error.code)
        } catch {
            let code = (error as? NativeAIError)?.code ?? NativeAIErrorCode.requestFailed
            logger.error("Native AI generate error [\(code)] conversation=\(request.conversationId ?? "<new>"): \(error.localizedDescription)")
            fail(500, error.localizedDescription, code)
        }
    }

}
