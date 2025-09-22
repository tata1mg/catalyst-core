//
//  NativeBridge.swift
//  iosnativeWebView
//
//  Created by Mayank Mahavar on 19/03/25.
//
import Foundation
import WebKit
import UIKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NativeBridge")

class NativeBridge: NSObject, ImageHandlerDelegate {
    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    private let imageHandler = ImageHandler()
    
    init(webView: WKWebView, viewController: UIViewController) {
        self.webView = webView
        self.viewController = viewController
        super.init()
        
        imageHandler.delegate = self
        iosnativeWebView.logger.debug("NativeBridge initialized")
    }
    
    // Register the JavaScript interface with the WebView
    func register() {
        let userContentController = webView?.configuration.userContentController
        userContentController?.add(self, name: "NativeBridge")
        
        // Inject the complete JavaScript interface to match Android functionality
        let script = """
        window.WebBridge = {
            // Native method calls (matching Android @JavascriptInterface methods)
            openCamera: function(options) {
                console.log('📱 iOS Bridge: openCamera called with options:', options);
                webkit.messageHandlers.NativeBridge.postMessage({
                    command: 'openCamera',
                    params: options || null
                });
            },

            requestCameraPermission: function(config) {
                console.log('📱 iOS Bridge: requestCameraPermission called with config:', config);
                webkit.messageHandlers.NativeBridge.postMessage({
                    command: 'requestCameraPermission',
                    params: config || null
                });
            },

            logger: function() {
                console.log('📱 iOS Bridge: logger called');
                webkit.messageHandlers.NativeBridge.postMessage({
                    command: 'logger',
                    params: null
                });
            },

            getDeviceInfo: function(options) {
                console.log('📱 iOS Bridge: getDeviceInfo called with options:', options);
                webkit.messageHandlers.NativeBridge.postMessage({
                    command: 'getDeviceInfo',
                    params: options || null
                });
            },

            // Registration system for callback handling
            handlers: new Map(),

            register: function(interfaceName, handler) {
                if (typeof handler !== 'function') {
                    console.error('📱 iOS Bridge: Handler must be a function');
                    return false;
                }

                if (this.handlers.has(interfaceName)) {
                    console.warn('📱 iOS Bridge: Interface ' + interfaceName + ' already registered, overriding');
                }

                console.log('📱 iOS Bridge: Registering callback interface:', interfaceName);
                this.handlers.set(interfaceName, handler);
                return true;
            },

            unregister: function(interfaceName) {
                if (!this.handlers.has(interfaceName)) {
                    console.warn('📱 iOS Bridge: Interface ' + interfaceName + ' not registered');
                    return false;
                }

                console.log('📱 iOS Bridge: Unregistering callback interface:', interfaceName);
                this.handlers.delete(interfaceName);
                return true;
            },

            isRegistered: function(interfaceName) {
                return this.handlers.has(interfaceName);
            },

            callback: function(eventName, data) {
                console.log('📱 iOS Bridge callback:', eventName, data ? {data: data} : '');

                if (!this.handlers.has(eventName)) {
                    console.warn('📱 iOS Bridge: No handler registered for interface:', eventName);
                    return;
                }

                try {
                    const handler = this.handlers.get(eventName);
                    handler(data);
                } catch (error) {
                    console.error('📱 iOS Bridge: Error executing callback for ' + eventName + ':', error);
                }
            }
        };

        // Auto-trigger a message to verify the bridge is working
        document.addEventListener('DOMContentLoaded', function() {
            console.log('📱 iOS Bridge: DOM ready, complete bridge initialized');
            console.log('📱 iOS Bridge: Available methods:', Object.keys(window.WebBridge));
        });
        """
        
        let userScript = WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        userContentController?.addUserScript(userScript)
        
        // Add observer for page load to auto-trigger a verification message
        webView?.addObserver(self, forKeyPath: #keyPath(WKWebView.isLoading), options: .new, context: nil)
    }
    
    // Unregister to prevent memory leaks
    func unregister() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "NativeBridge")
        webView?.removeObserver(self, forKeyPath: #keyPath(WKWebView.isLoading))
    }
    
    // Observer for page load state
    override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey : Any]?, context: UnsafeMutableRawPointer?) {
        if keyPath == #keyPath(WKWebView.isLoading),
           let webView = object as? WKWebView,
           !webView.isLoading {
            // Page finished loading, send verification message after a short delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.sendVerificationMessage()
            }
        }
    }
    
    // Send verification message to JavaScript
    private func sendVerificationMessage() {
        sendCallback(eventName: "BRIDGE_READY", data: "iOS Native Bridge is working correctly!")
    }
    
    // Helper function to run JavaScript in the WebView
    private func evaluateJavaScript(_ script: String) {
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(script) { result, error in
                if let error = error {
                    iosnativeWebView.logger.error("Error executing JavaScript: \(error.localizedDescription)")
                }
            }
        }
    }
    
    // Helper function to send data back to WebView
    private func sendCallback(eventName: String, data: String = "") {
        let escapedData = data.replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        
        let script = "window.WebBridge.callback('\(eventName)', \"\(escapedData)\")"
        evaluateJavaScript(script)
    }
    
    // Open camera and capture image
    @objc func openCamera() {
        // Try to find a valid UIViewController from the window hierarchy
        var presentingViewController: UIViewController?
        
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = scene.windows.first?.rootViewController {
            // Use the root view controller or find a presented controller
            presentingViewController = rootVC.presentedViewController ?? rootVC
        } else {
            // Fallback to the provided viewController
            presentingViewController = viewController
        }
        
        guard let presentingVC = presentingViewController else {
            iosnativeWebView.logger.error("No valid view controller available")
            sendCallback(eventName: "ON_CAMERA_ERROR", data: "Error: No valid view controller available")
            return
        }
        
        imageHandler.checkCameraPermission { [weak self] granted in
            guard let self = self else { return }
            
            if granted {
                self.imageHandler.presentCamera(from: presentingVC)
            } else {
                iosnativeWebView.logger.error("Camera permission denied")
                self.sendCallback(eventName: "CAMERA_PERMISSION_STATUS", data: "DENIED")
                self.imageHandler.presentPermissionAlert(from: presentingVC)
            }
        }
    }
    
    @objc func requestCameraPermission() {
        iosnativeWebView.logger.debug("Camera permission requested")
        
        imageHandler.checkCameraPermission { [weak self] granted in
            guard let self = self else { return }
            
            let permissionStatus = granted ? "GRANTED" : "DENIED"
            iosnativeWebView.logger.debug("Camera permission status: \(permissionStatus)")
            
            let json: [String: String] = [
                "status": permissionStatus
            ]
            
            if let jsonData = try? JSONSerialization.data(withJSONObject: json),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                self.sendCallback(eventName: "CAMERA_PERMISSION_STATUS", data: jsonString)
            } else {
                // Fallback to a simple JSON string if serialization fails
                let jsonString = "{\"status\": \"\(permissionStatus)\"}"
                self.sendCallback(eventName: "CAMERA_PERMISSION_STATUS", data: jsonString)
            }
        }
    }
    
    // Get device information
    @objc func getDeviceInfo() {
        iosnativeWebView.logger.debug("getDeviceInfo called")

        let device = UIDevice.current
        let screen = UIScreen.main

        let deviceInfo: [String: Any] = [
            "model": device.model,
            "manufacturer": "Apple",
            "platform": "iOS",
            "systemVersion": device.systemVersion,
            "screenWidth": Int(screen.bounds.width * screen.scale),
            "screenHeight": Int(screen.bounds.height * screen.scale),
            "screenDensity": screen.scale
        ]

        do {
            let jsonData = try JSONSerialization.data(withJSONObject: deviceInfo)
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                sendCallback(eventName: "ON_DEVICE_INFO_SUCCESS", data: jsonString)
            } else {
                sendCallback(eventName: "ON_DEVICE_INFO_ERROR", data: "Failed to serialize device info")
            }
        } catch {
            iosnativeWebView.logger.error("Error serializing device info: \(error.localizedDescription)")
            sendCallback(eventName: "ON_DEVICE_INFO_ERROR", data: "Error: \(error.localizedDescription)")
        }
    }

    // Log message (test function)
    @objc func logger() {
        iosnativeWebView.logger.debug("Message from native")
        sendCallback(eventName: "ON_LOGGER", data: "From native, with regards")
    }
    
    // MARK: - ImageHandlerDelegate
    func imageHandler(_ handler: ImageHandler, didCaptureImageAt url: URL) {
        // Create JSON response with file URL
        let json: [String: String] = [
            "imageUrl": url.absoluteString
        ]
        
        if let jsonData = try? JSONSerialization.data(withJSONObject: json),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            iosnativeWebView.logger.debug("Image captured successfully at: \(url.absoluteString)")
            sendCallback(eventName: "ON_CAMERA_CAPTURE", data: jsonString)
        } else {
            // Fallback to a simple JSON string if serialization fails
            let jsonString = "{\"imageUrl\": \"\(url.absoluteString)\"}"
            sendCallback(eventName: "ON_CAMERA_CAPTURE", data: jsonString)
        }
    }
    
    func imageHandlerDidCancel(_ handler: ImageHandler) {
        iosnativeWebView.logger.debug("Camera capture cancelled")
        sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Cancelled")
    }
    
    func imageHandler(_ handler: ImageHandler, didFailWithError error: Error) {
        iosnativeWebView.logger.error("Camera error: \(error.localizedDescription)")
        sendCallback(eventName: "ON_CAMERA_ERROR", data: "Error: \(error.localizedDescription)")
    }
}

// MARK: - WKScriptMessageHandler
extension NativeBridge: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else {
            iosnativeWebView.logger.error("Invalid message format")
            return
        }
        
        iosnativeWebView.logger.debug("Received message: \(body)")
        
        if message.name == "NativeBridge" {
            if let command = body["command"] as? String {
                let params = body["params"]

                switch command {
                case "openCamera":
                    openCamera()
                case "requestCameraPermission":
                    requestCameraPermission()
                case "getDeviceInfo":
                    getDeviceInfo()
                case "logger":
                    logger()
                default:
                    iosnativeWebView.logger.error("Unknown command: \(command)")
                }
            }
        }
    }
}
