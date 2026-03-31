import Foundation
import WebKit
import UIKit
import os

private let pluginBridgeLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "PluginBridge")

private struct PluginBridgeValidationError: LocalizedError {
    let message: String
    let code: String

    var errorDescription: String? {
        message
    }
}

private struct PluginRequest {
    let pluginId: String
    let command: String
    let data: Any?
    let requestId: String?
}

protocol PluginBridgeMessage {
    var name: String { get }
    var body: Any { get }
}

extension WKScriptMessage: PluginBridgeMessage {}

final class PluginBridge: NSObject {
    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    private var messageHandlerProxy: WeakScriptMessageHandler?
    private var isRegistered = false

    private let pluginFactories = GeneratedPluginIndex.pluginFactories
    private let pluginToCommands = GeneratedPluginIndex.pluginToCommands

    private let bridgeName = "PluginBridge"
    private let errorEvent = "PLUGIN_BRIDGE_ERROR"
    private let systemPluginId = "__bridge__"

    init(webView: WKWebView, viewController: UIViewController) {
        self.webView = webView
        self.viewController = viewController
        super.init()
    }

    func register() {
        guard !isRegistered else { return }
        guard let userContentController = webView?.configuration.userContentController else {
            return
        }
        let proxy = WeakScriptMessageHandler(delegate: self)
        userContentController.add(proxy, name: bridgeName)
        messageHandlerProxy = proxy
        isRegistered = true
    }

    func unregister() {
        guard isRegistered else { return }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: bridgeName)
        messageHandlerProxy = nil
        isRegistered = false
    }

    deinit {
        unregister()
    }

    private func parseRequest(_ message: PluginBridgeMessage) throws -> PluginRequest {
        guard message.name == bridgeName else {
            throw PluginBridgeValidationError(message: "Invalid message handler", code: "INVALID_PAYLOAD")
        }

        let body: [String: Any]
        if let dictionary = message.body as? [String: Any] {
            body = dictionary
        } else if let dictionary = message.body as? NSDictionary,
                  let castedBody = dictionary as? [String: Any] {
            body = castedBody
        } else {
            throw PluginBridgeValidationError(message: "Payload must be an object", code: "INVALID_PAYLOAD")
        }

        guard JSONSerialization.isValidJSONObject(body) else {
            throw PluginBridgeValidationError(message: "Payload must be JSON-serializable", code: "INVALID_PAYLOAD")
        }

        let payloadData: Data
        do {
            payloadData = try JSONSerialization.data(withJSONObject: body)
        } catch {
            throw PluginBridgeValidationError(message: "Invalid payload", code: "INVALID_PAYLOAD")
        }

        if payloadData.count > CatalystConstants.Bridge.maxMessageSize {
            throw PluginBridgeValidationError(message: "Payload exceeds maximum size", code: "INVALID_PAYLOAD")
        }

        let pluginId = (body["pluginId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let command = (body["command"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let requestId = (body["requestId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)

        return PluginRequest(
            pluginId: pluginId,
            command: command,
            data: body["data"],
            requestId: requestId?.isEmpty == true ? nil : requestId
        )
    }

    private func hasPlugin(_ pluginId: String) -> Bool {
        pluginFactories[pluginId] != nil
    }

    private func hasCommand(pluginId: String, command: String) -> Bool {
        pluginToCommands[pluginId]?.contains(command) ?? false
    }

    private func sendBridgeError(message: String, code: String, request: PluginRequest?) {
        let bridge = PluginBridgeContext(
            webView: webView,
            viewController: viewController,
            pluginId: systemPluginId,
            command: request?.command,
            requestId: request?.requestId
        )
        var payload: [String: Any] = [
            "message": message,
            "code": code,
            "pluginId": request?.pluginId ?? systemPluginId,
        ]
        if let command = request?.command, !command.isEmpty {
            payload["command"] = command
        }
        bridge.callback(eventName: errorEvent, data: payload)
    }

    func handleMessage(_ message: PluginBridgeMessage) {
        var request: PluginRequest?

        do {
            let parsedRequest = try parseRequest(message)
            request = parsedRequest

            if parsedRequest.pluginId.isEmpty {
                sendBridgeError(message: "pluginId is required", code: "INVALID_PAYLOAD", request: parsedRequest)
                return
            }
            if parsedRequest.command.isEmpty {
                sendBridgeError(message: "command is required", code: "INVALID_PAYLOAD", request: parsedRequest)
                return
            }

            if !hasPlugin(parsedRequest.pluginId) {
                sendBridgeError(
                    message: "Unsupported plugin: \(parsedRequest.pluginId)",
                    code: "PLUGIN_NOT_FOUND",
                    request: parsedRequest
                )
                return
            }

            if !hasCommand(pluginId: parsedRequest.pluginId, command: parsedRequest.command) {
                sendBridgeError(
                    message: "Unsupported command '\(parsedRequest.command)' for plugin '\(parsedRequest.pluginId)'",
                    code: "COMMAND_NOT_SUPPORTED",
                    request: parsedRequest
                )
                return
            }

            guard let factory = pluginFactories[parsedRequest.pluginId] else {
                sendBridgeError(
                    message: "No plugin registered for id: \(parsedRequest.pluginId)",
                    code: "PLUGIN_NOT_REGISTERED",
                    request: parsedRequest
                )
                return
            }

            let plugin = factory()
            let bridge = PluginBridgeContext(
                webView: webView,
                viewController: viewController,
                pluginId: parsedRequest.pluginId,
                command: parsedRequest.command,
                requestId: parsedRequest.requestId
            )
            plugin.handle(command: parsedRequest.command, data: parsedRequest.data, bridge: bridge)
        } catch let error as PluginBridgeValidationError {
            sendBridgeError(message: error.message, code: error.code, request: request)
        } catch {
            pluginBridgeLogger.error("Plugin command failed: \(error.localizedDescription)")
            sendBridgeError(
                message: "Plugin execution failed: \(error.localizedDescription)",
                code: "PLUGIN_EXECUTION_FAILED",
                request: request
            )
        }
    }
}

extension PluginBridge: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        handleMessage(message)
    }
}

final class PluginBridgeContext {
    weak var webView: WKWebView?
    weak var viewController: UIViewController?

    private let systemPluginId = "__bridge__"
    private let bridgeErrorEvent = "PLUGIN_BRIDGE_ERROR"

    let pluginId: String
    let command: String?
    let requestId: String?

    init(
        webView: WKWebView?,
        viewController: UIViewController?,
        pluginId: String,
        command: String?,
        requestId: String?
    ) {
        self.webView = webView
        self.viewController = viewController
        self.pluginId = pluginId
        self.command = command
        self.requestId = requestId
    }

    func callback(
        eventName: String,
        data: Any?,
        command: String? = nil
    ) {
        let resolvedRequestId = self.requestId
        let resolvedCommand = command ?? self.command
        let trimmedEventName = eventName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedEventName.isEmpty else {
            emitBridgeError(
                message: "Rejected callback with blank event name for plugin \(self.pluginId)",
                code: "INVALID_CALLBACK",
                requestId: resolvedRequestId,
                command: resolvedCommand
            )
            return
        }
        if !dispatchEnvelope(
            pluginId: pluginId,
            eventName: trimmedEventName,
            payload: data,
            requestId: resolvedRequestId,
            command: resolvedCommand
        ) {
            if pluginId == systemPluginId && trimmedEventName == bridgeErrorEvent {
                pluginBridgeLogger.error("Failed to dispatch bridge error event for plugin \(self.pluginId)")
                return
            }

            emitBridgeError(
                message: "Failed to dispatch callback \(trimmedEventName) for plugin \(self.pluginId)",
                code: "PLUGIN_EXECUTION_FAILED",
                requestId: resolvedRequestId,
                command: resolvedCommand
            )
        }
    }

    private func emitBridgeError(
        message: String,
        code: String,
        requestId: String?,
        command: String?
    ) {
        var payload: [String: Any] = [
            "message": message,
            "code": code,
            "pluginId": pluginId,
        ]

        if let command = command, !command.isEmpty {
            payload["command"] = command
        }

        if !dispatchEnvelope(
            pluginId: systemPluginId,
            eventName: bridgeErrorEvent,
            payload: payload,
            requestId: requestId,
            command: command,
            logFailures: false
        ) {
            pluginBridgeLogger.error("Failed to dispatch bridge error for plugin \(self.pluginId): \(message)")
        }
    }

    private func dispatchEnvelope(
        pluginId: String,
        eventName: String,
        payload: Any?,
        requestId: String?,
        command: String?,
        logFailures: Bool = true
    ) -> Bool {
        guard let webView = webView else {
            if logFailures {
                pluginBridgeLogger.error("WebView unavailable for plugin callback \(eventName)")
            }
            return false
        }

        let envelope: [String: Any] = [
            "pluginId": pluginId,
            "eventName": eventName,
            "payload": payload ?? NSNull(),
            "requestId": requestId ?? NSNull(),
            "command": command ?? NSNull(),
        ]

        guard JSONSerialization.isValidJSONObject(envelope),
              let envelopeData = try? JSONSerialization.data(withJSONObject: envelope),
              let envelopeJson = String(data: envelopeData, encoding: .utf8) else {
            if logFailures {
                pluginBridgeLogger.error("Failed to serialize plugin callback envelope for \(pluginId).\(eventName)")
            }
            return false
        }

        let envelopeLiteral = javaScriptStringLiteral(envelopeJson)
        let script = "window.PluginBridgeWeb && window.PluginBridgeWeb.dispatch(\(envelopeLiteral));"

        DispatchQueue.main.async {
            webView.evaluateJavaScript(
                script,
                completionHandler: { _, error in
                    if let error = error {
                        pluginBridgeLogger.error(
                            "Plugin callback JS failed for \(pluginId).\(eventName): \(error.localizedDescription)"
                        )
                    }
                }
            )
        }

        return true
    }

    private func javaScriptStringLiteral(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return "\"\(escaped)\""
    }
}
