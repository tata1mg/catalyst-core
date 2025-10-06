//
//  BridgeJavaScriptInterface.swift
//  iosnativeWebView
//
//  JavaScript communication interface for WebView bridge
//  Extracted from NativeBridge.swift for better separation of concerns
//

import Foundation
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: CatalystConstants.Logging.Categories.javascriptInterface)

// MARK: - JavaScript Interface

class BridgeJavaScriptInterface {

    private weak var webView: WKWebView?

    init(webView: WKWebView) {
        self.webView = webView
        logger.debug("BridgeJavaScriptInterface initialized")
    }

    deinit {
        logger.debug("BridgeJavaScriptInterface deallocated")
    }

    // MARK: - JavaScript Execution

    // Helper function to run JavaScript in the WebView
    func evaluateJavaScript(_ script: String, completion: ((Any?, Error?) -> Void)? = nil) {
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(script) { result, error in
                if let error = error {
                    logger.error("Error executing JavaScript: \(error.localizedDescription)")
                }
                completion?(result, error)
            }
        }
    }

    // MARK: - Callback Methods

    // Legacy helper function for backward compatibility - converts string to JSON format
    func sendCallback(eventName: String, data: String = "") {
        sendJSONCallback(eventName: eventName, data: ["message": data])
    }

    // Primary helper function to send structured JSON data back to WebView
    // Uses proper JSON serialization to prevent injection vulnerabilities
    func sendJSONCallback(eventName: String, data: [String: Any]) {
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: data, options: [])
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                let script = "window.WebBridge.callback('\(eventName)', \(jsonString))"
                evaluateJavaScript(script)
            } else {
                logger.error("Failed to convert JSON data to string for event: \(eventName)")
                sendErrorCallback(eventName: eventName, error: "Failed to serialize callback data", code: "JSON_SERIALIZATION_ERROR")
            }
        } catch {
            logger.error("Failed to serialize JSON for event \(eventName): \(error.localizedDescription)")
            sendErrorCallback(eventName: eventName, error: "JSON serialization failed", code: "JSON_SERIALIZATION_ERROR")
        }
    }

    // Helper function to send standardized error responses with consistent JSON format
    // Includes error details, error codes, timestamps and platform identification
    func sendErrorCallback(eventName: String, error: String, code: String = "UNKNOWN_ERROR") {
        let errorData: [String: Any] = [
            "error": error,
            "code": code,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "platform": "ios"
        ]

        do {
            let jsonData = try JSONSerialization.data(withJSONObject: errorData, options: [])
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                let script = "window.WebBridge.callback('\(eventName)', \(jsonString))"
                evaluateJavaScript(script)
            } else {
                // Fallback to basic error if JSON serialization fails
                let fallbackScript = "window.WebBridge.callback('\(eventName)', '{\"error\":\"\(error)\",\"code\":\"\(code)\"}')"
                evaluateJavaScript(fallbackScript)
            }
        } catch {
            // Ultimate fallback
            let fallbackScript = "window.WebBridge.callback('\(eventName)', '{\"error\":\"\(error)\",\"code\":\"\(code)\"}')"
            evaluateJavaScript(fallbackScript)
        }
    }

    // MARK: - Utility Methods

    // Check if WebView is available and ready
    func isWebViewReady() -> Bool {
        return webView != nil
    }

    // Get current WebView instance (for advanced use cases)
    func getWebView() -> WKWebView? {
        return webView
    }

    // Update WebView reference (in case WebView is recreated)
    func updateWebView(_ newWebView: WKWebView) {
        self.webView = newWebView
        logger.debug("WebView reference updated in JavaScript interface")
    }

    // MARK: - Debug and Testing Support

    // Execute JavaScript and return result synchronously (for testing)
    func evaluateJavaScriptSync(_ script: String) -> (result: Any?, error: Error?) {
        var syncResult: Any?
        var syncError: Error?
        let semaphore = DispatchSemaphore(value: 0)

        evaluateJavaScript(script) { result, error in
            syncResult = result
            syncError = error
            semaphore.signal()
        }

        semaphore.wait()
        return (result: syncResult, error: syncError)
    }

    // Send test callback for debugging bridge communication
    func sendTestCallback() {
        sendJSONCallback(eventName: "BRIDGE_TEST", data: [
            "message": "Bridge JavaScript interface is working",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "platform": "ios",
            "component": "BridgeJavaScriptInterface"
        ])
    }
}