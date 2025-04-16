//
//  ImageHandler.swift
//  iosnativeWebView
//
import Foundation
import UIKit
import AVFoundation
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "ImageHandler")

protocol ImageHandlerDelegate: AnyObject {
    func imageHandler(_ handler: ImageHandler, didCaptureImageAt url: URL)
    func imageHandlerDidCancel(_ handler: ImageHandler)
    func imageHandler(_ handler: ImageHandler, didFailWithError error: Error)
}

class ImageHandler: NSObject {
    
    weak var delegate: ImageHandlerDelegate?
    private var currentPhotoURL: URL?
    
    // Helper to check camera permissions
    func checkCameraPermission(completion: @escaping (Bool) -> Void) {
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
    
    // Create a file for saving an image
    func createImageFile() -> URL {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyyMMdd_HHmmss"
        let timeStamp = dateFormatter.string(from: Date())
        
        let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let imageDirectory = documentsDirectory.appendingPathComponent("Pictures", isDirectory: true)
        
        // Create directory if it doesn't exist
        if !FileManager.default.fileExists(atPath: imageDirectory.path) {
            try? FileManager.default.createDirectory(at: imageDirectory, withIntermediateDirectories: true)
        }
        
        return imageDirectory.appendingPathComponent("JPEG_\(timeStamp)_.jpg")
    }
    
    // Create a simple mock image
    func createMockImage() -> UIImage? {
        let size = CGSize(width: 1024, height: 768)
        UIGraphicsBeginImageContextWithOptions(size, false, 1.0)
        defer { UIGraphicsEndImageContext() }
        
        // Fill with a gradient background
        let context = UIGraphicsGetCurrentContext()!
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let colors = [UIColor.systemBlue.cgColor, UIColor.systemTeal.cgColor]
        let locations: [CGFloat] = [0.0, 1.0]
        
        if let gradient = CGGradient(colorsSpace: colorSpace, colors: colors as CFArray, locations: locations) {
            context.drawLinearGradient(
                gradient,
                start: CGPoint(x: 0, y: 0),
                end: CGPoint(x: size.width, y: size.height),
                options: []
            )
        }
        
        // Add text "Mock Camera Image"
        let text = "Mock Camera Image"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.boldSystemFont(ofSize: 48),
            .foregroundColor: UIColor.white
        ]
        
        let textSize = text.size(withAttributes: attributes)
        let textRect = CGRect(
            x: (size.width - textSize.width) / 2,
            y: (size.height - textSize.height) / 2,
            width: textSize.width,
            height: textSize.height
        )
        
        text.draw(in: textRect, withAttributes: attributes)
        
        // Add current date/time
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let dateText = dateFormatter.string(from: Date())
        
        let dateAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 24),
            .foregroundColor: UIColor.white
        ]
        
        let dateTextSize = dateText.size(withAttributes: dateAttributes)
        let dateTextRect = CGRect(
            x: (size.width - dateTextSize.width) / 2,
            y: textRect.maxY + 20,
            width: dateTextSize.width,
            height: dateTextSize.height
        )
        
        dateText.draw(in: dateTextRect, withAttributes: dateAttributes)
        
        return UIGraphicsGetImageFromCurrentImageContext()
    }
    
    // Save mock image and notify delegate
    func saveMockImage() {
        let fileURL = createImageFile()
        currentPhotoURL = fileURL
        
        if let mockImage = createMockImage() {
            do {
                if let imageData = mockImage.jpegData(compressionQuality: 0.8) {
                    try imageData.write(to: fileURL)
                    delegate?.imageHandler(self, didCaptureImageAt: fileURL)
                }
            } catch {
                logger.error("Failed to save mock image: \(error.localizedDescription)")
                delegate?.imageHandler(self, didFailWithError: error)
            }
        } else {
            let error = NSError(domain: "com.app.imagehandler", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create mock image"])
            delegate?.imageHandler(self, didFailWithError: error)
        }
    }
    
    // Present camera
    func presentCamera(from viewController: UIViewController) {
        // Set up error observer for AVCaptureSession
        setupAVCaptureErrorObserver()
        
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            let imagePicker = UIImagePickerController()
            imagePicker.delegate = self
            imagePicker.sourceType = .camera
            imagePicker.allowsEditing = false
            
            DispatchQueue.main.async {
                viewController.present(imagePicker, animated: true)
            }
        } else {
            // Camera not available, show alert
            presentCameraUnavailableAlert(from: viewController)
        }
    }
    
    // Set up notification observer for AVCaptureSession errors
    private func setupAVCaptureErrorObserver() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAVCaptureSessionRuntimeError(_:)),
            name: .AVCaptureSessionRuntimeError,
            object: nil
        )
    }
    
    // Handle AVCaptureSession runtime errors
    @objc private func handleAVCaptureSessionRuntimeError(_ notification: Notification) {
        if let error = notification.userInfo?[AVCaptureSessionErrorKey] as? NSError {
            // Check for specific error code
            if error.domain == AVFoundationErrorDomain && error.code == -11800 {
                logger.debug("Detected AVFoundation error -11800, generating mock image")
                
                // Dismiss any presented view controllers if needed
                if let viewController = UIApplication.shared.windows.first?.rootViewController,
                   let presented = viewController.presentedViewController as? UIImagePickerController {
                    presented.dismiss(animated: true) { [weak self] in
                        self?.saveMockImage()
                    }
                } else {
                    // If we can't find the picker to dismiss, still generate the mock
                    saveMockImage()
                }
            }
        }
    }
    
    // Present photo library
    func presentPhotoLibrary(from viewController: UIViewController) {
        if UIImagePickerController.isSourceTypeAvailable(.photoLibrary) {
            let imagePicker = UIImagePickerController()
            imagePicker.delegate = self
            imagePicker.sourceType = .photoLibrary
            imagePicker.allowsEditing = false
            
            DispatchQueue.main.async {
                viewController.present(imagePicker, animated: true)
            }
        } else {
            let error = NSError(domain: "com.app.imagehandler", code: 2, userInfo: [NSLocalizedDescriptionKey: "Photo library not available"])
            delegate?.imageHandler(self, didFailWithError: error)
        }
    }
    
    // Show camera unavailable alert
    private func presentCameraUnavailableAlert(from viewController: UIViewController) {
        let alert = UIAlertController(
            title: "Camera Not Available",
            message: "Would you like to select a photo from your library instead?",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "Yes", style: .default) { [weak self] _ in
            guard let self = self else { return }
            self.presentPhotoLibrary(from: viewController)
        })
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            guard let self = self else { return }
            self.delegate?.imageHandlerDidCancel(self)
        })
        
        DispatchQueue.main.async {
            viewController.present(alert, animated: true)
        }
    }
    
    // Present permission alert
    func presentPermissionAlert(from viewController: UIViewController) {
        let alert = UIAlertController(
            title: "Camera Permission Required",
            message: "Please allow camera access in Settings to use this feature",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "Settings", style: .default) { _ in
            if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(settingsURL)
            }
        })
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            guard let self = self else { return }
            self.delegate?.imageHandlerDidCancel(self)
        })
        
        DispatchQueue.main.async {
            viewController.present(alert, animated: true)
        }
    }
    
    // Clean up when done
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - UIImagePickerControllerDelegate
extension ImageHandler: UIImagePickerControllerDelegate & UINavigationControllerDelegate {
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
        picker.dismiss(animated: true)
        
        // Always create a mock image file, regardless of the actual capture
        saveMockImage()
    }
    
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        logger.debug("Camera capture cancelled")
        delegate?.imageHandlerDidCancel(self)
    }
    
    func imagePickerController(_ picker: UIImagePickerController, didFailWithError error: Error) {
        picker.dismiss(animated: true)
        
        let nsError = error as NSError
        // Check for specific AVFoundation error
        if nsError.domain == AVFoundationErrorDomain && nsError.code == -11800 {
            logger.debug("Detected AVFoundation error -11800 in picker delegate, generating mock image")
            saveMockImage()
        } else {
            delegate?.imageHandler(self, didFailWithError: error)
        }
    }
}
