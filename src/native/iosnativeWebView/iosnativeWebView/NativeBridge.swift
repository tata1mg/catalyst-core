//
//  NativeBridge.swift
//  iosnativeWebView
//
//  Created by Mayank Mahavar on 19/03/25.
//
import Foundation
import WebKit
import UIKit
import AVFoundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "NativeBridge")

class NativeBridge: NSObject {
    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    
    init(webView: WKWebView, viewController: UIViewController) {
        self.webView = webView
        self.viewController = viewController
        super.init()
        
        iosnativeWebView.logger.debug("NativeBridge initialized")
    }
    
    // Register the JavaScript interface with the WebView
    func register() {
        let userContentController = webView?.configuration.userContentController
        userContentController?.add(self, name: "NativeBridge")
        
        // Inject the JavaScript interface
        let script = """
        window.WebBridge = {
            callback: function(eventName, data) {
                console.log('📱 Native Bridge:', eventName, data);
                // This function will be defined by web code to handle native callbacks
            }
        };
        
        // Auto-trigger a message to verify the bridge is working
        document.addEventListener('DOMContentLoaded', function() {
            console.log('📱 Native Bridge: DOM ready, bridge initialized');
            // This will be visible in the console without any user interaction
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
        let script = "window.WebBridge.callback('\(eventName)', '\(escapedData)')"
        evaluateJavaScript(script)
    }
    
    // Helper to check camera permissions
    private func checkCameraPermission(completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    completion(granted)
                }
            }
        case .denied, .restricted:
            completion(false)
        @unknown default:
            completion(false)
        }
    }
    
    // Open camera and capture image
    @objc func openCamera() {
        guard let viewController = viewController else {
            iosnativeWebView.logger.error("ViewController not available")
            sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Error: ViewController not available")
            return
        }
        
        checkCameraPermission { [weak self] granted in
            guard let self = self else { return }
            
            if granted {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    let imagePicker = UIImagePickerController()
                    imagePicker.delegate = self
                    imagePicker.sourceType = .camera
                    imagePicker.allowsEditing = false
                    
                    viewController.present(imagePicker, animated: true)
                } else {
                    iosnativeWebView.logger.error("Camera not available")
                    self.sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Error: No camera available")
                }
            } else {
                iosnativeWebView.logger.error("Camera permission denied")
                self.sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Error: Camera permission denied")
            }
        }
    }
    
    // Log message (test function)
    @objc func logger() {
        iosnativeWebView.logger.debug("Message from native")
        sendCallback(eventName: "ON_LOGGER", data: "From native, with regards")
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
                switch command {
                case "openCamera":
                    openCamera()
                case "logger":
                    logger()
                default:
                    iosnativeWebView.logger.error("Unknown command: \(command)")
                }
            }
        }
    }
}

// MARK: - UIImagePickerControllerDelegate
extension NativeBridge: UIImagePickerControllerDelegate & UINavigationControllerDelegate {
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
        picker.dismiss(animated: true)
        
        if let image = info[.originalImage] as? UIImage {
            if let base64Image = convertImageToBase64(image) {
                iosnativeWebView.logger.debug("Image captured successfully")
                sendCallback(eventName: "ON_CAMERA_CAPTURE", data: base64Image)
            } else {
                iosnativeWebView.logger.error("Failed to convert image to base64")
                sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Error: Failed to process image")
            }
        } else {
            iosnativeWebView.logger.error("No image captured")
            sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Error: No image captured")
        }
    }
    
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        iosnativeWebView.logger.debug("Camera capture cancelled")
        sendCallback(eventName: "ON_CAMERA_CAPTURE", data: "Cancelled")
    }
    
    private func convertImageToBase64(_ image: UIImage) -> String? {
        guard let imageData = image.jpegData(compressionQuality: 0.9) else {
            return nil
        }
        return imageData.base64EncodedString()
    }
} 
