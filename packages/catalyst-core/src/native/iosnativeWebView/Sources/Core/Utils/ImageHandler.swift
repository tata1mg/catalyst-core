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
    func imageHandler(_ handler: ImageHandler, didCaptureImageAt url: URL, withOptions options: [String: Any])
    func imageHandlerDidCancel(_ handler: ImageHandler)
    func imageHandler(_ handler: ImageHandler, didFailWithError error: Error)
}

class ImageHandler: NSObject {

    weak var delegate: ImageHandlerDelegate?
    private var currentPhotoURL: URL?
    private var currentCameraOptions: [String: Any] = [:]
    
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
    
    // Save actual camera captured image and notify delegate
    func saveActualCameraImage(_ image: UIImage) {
        let fileURL = createImageFile()
        currentPhotoURL = fileURL

        do {
            // Apply quality and format based on current options
            let imageData = processImageWithOptions(image, options: currentCameraOptions)
            try imageData.write(to: fileURL)

            logger.debug("Actual camera image saved successfully to: \(fileURL.path)")
            delegate?.imageHandler(self, didCaptureImageAt: fileURL, withOptions: currentCameraOptions)

        } catch {
            logger.error("Failed to save actual camera image: \(error.localizedDescription)")
            delegate?.imageHandler(self, didFailWithError: error)
        }
    }

    // Save mock image and notify delegate (for simulator/testing)
    func saveMockImage() {
        let fileURL = createImageFile()
        currentPhotoURL = fileURL

        if let mockImage = createMockImage() {
            do {
                // Apply quality based on current options
                let imageData = processImageWithOptions(mockImage, options: currentCameraOptions)
                try imageData.write(to: fileURL)

                logger.debug("Mock camera image saved for testing/simulator")
                delegate?.imageHandler(self, didCaptureImageAt: fileURL, withOptions: currentCameraOptions)

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
    func presentCamera(from viewController: UIViewController, options: [String: Any] = [:]) {
        logger.debug("presentCamera called with options: \(options)")

        // Store options for later use during image processing
        currentCameraOptions = options

        // Set up error observer for AVCaptureSession
        setupAVCaptureErrorObserver()

        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            let imagePicker = UIImagePickerController()
            imagePicker.delegate = self
            imagePicker.sourceType = .camera

            // Apply camera options
            applyCameraOptions(to: imagePicker, options: options)

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
                if let rootViewController = topMostRootViewController(),
                   let presented = rootViewController.presentedViewController as? UIImagePickerController {
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
    
    private func topMostRootViewController() -> UIViewController? {
        let windowScenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
        
        if let keyWindow = windowScenes
            .flatMap({ $0.windows })
            .first(where: { $0.isKeyWindow }) {
            return keyWindow.rootViewController
        }
        
        return windowScenes.first?.windows.first?.rootViewController
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
        let isSimulator = isRunningOnSimulator()
        let title = isSimulator ? "Camera Not Available in Simulator" : "Camera Not Available"
        let message = isSimulator
            ? "Camera functionality requires a physical device. Would you like to use a mock image for testing?"
            : "Would you like to select a photo from your library instead?"

        let alert = UIAlertController(
            title: title,
            message: message,
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "Yes", style: .default) { [weak self] _ in
            guard let self = self else { return }
            if isSimulator {
                // Use mock image for simulator testing
                self.saveMockImage()
            } else {
                // Use photo library on device when camera unavailable
                self.presentPhotoLibrary(from: viewController)
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
    
    // Apply camera options to UIImagePickerController
    private func applyCameraOptions(to imagePicker: UIImagePickerController, options: [String: Any]) {
        logger.debug("Applying camera options: \(options)")

        // Handle allowEditing option
        if let allowEditing = options["allowEditing"] as? Bool {
            imagePicker.allowsEditing = allowEditing
            logger.debug("Set allowsEditing to: \(allowEditing)")
        } else {
            imagePicker.allowsEditing = false // Default to false
        }

        // Handle camera device (front/rear) - this will be available if we extend later
        if let cameraDevice = options["cameraDevice"] as? String {
            switch cameraDevice.lowercased() {
            case "front":
                if UIImagePickerController.isCameraDeviceAvailable(.front) {
                    imagePicker.cameraDevice = .front
                    logger.debug("Set camera device to front")
                }
            case "rear", "back":
                if UIImagePickerController.isCameraDeviceAvailable(.rear) {
                    imagePicker.cameraDevice = .rear
                    logger.debug("Set camera device to rear")
                }
            default:
                logger.debug("Unknown camera device: \(cameraDevice), using default")
            }
        }

        // Handle flash mode
        if let flashMode = options["flashMode"] as? String {
            switch flashMode.lowercased() {
            case "auto":
                if UIImagePickerController.isFlashAvailable(for: imagePicker.cameraDevice) {
                    imagePicker.cameraFlashMode = .auto
                    logger.debug("Set flash mode to auto")
                }
            case "on":
                if UIImagePickerController.isFlashAvailable(for: imagePicker.cameraDevice) {
                    imagePicker.cameraFlashMode = .on
                    logger.debug("Set flash mode to on")
                }
            case "off":
                imagePicker.cameraFlashMode = .off
                logger.debug("Set flash mode to off")
            default:
                logger.debug("Unknown flash mode: \(flashMode), using default")
            }
        }

        // Quality setting will be handled during image processing
        if let quality = options["quality"] as? String {
            logger.debug("Camera quality setting noted for processing: \(quality)")
        }

        // Format setting will be handled during image processing
        if let format = options["format"] as? String {
            logger.debug("Camera format setting noted for processing: \(format)")
        }
    }

    /**
     * Process image with camera options (quality, format)
     */
    private func processImageWithOptions(_ image: UIImage, options: [String: Any]) -> Data {
        let quality = getCompressionQuality(from: options)
        let format = getImageFormat(from: options)

        switch format.lowercased() {
        case "png":
            logger.debug("Processing image as PNG format")
            return image.pngData() ?? Data()

        case "jpeg", "jpg":
            logger.debug("Processing image as JPEG with quality: \(quality)")
            return image.jpegData(compressionQuality: quality) ?? Data()

        default:
            logger.debug("Using default JPEG format with quality: \(quality)")
            return image.jpegData(compressionQuality: quality) ?? Data()
        }
    }

    /**
     * Get compression quality from camera options
     */
    private func getCompressionQuality(from options: [String: Any]) -> CGFloat {
        guard let qualityString = options["quality"] as? String else {
            return CatalystConstants.ImageProcessing.defaultQuality
        }

        switch qualityString.lowercased() {
        case "high":
            return CatalystConstants.ImageProcessing.Quality.high
        case "low":
            return CatalystConstants.ImageProcessing.Quality.low
        case "medium":
            return CatalystConstants.ImageProcessing.Quality.medium
        default:
            return CatalystConstants.ImageProcessing.defaultQuality
        }
    }

    /**
     * Get image format from camera options
     */
    private func getImageFormat(from options: [String: Any]) -> String {
        guard let format = options["format"] as? String else {
            return "jpeg" // Default format
        }
        return format.lowercased()
    }

    /**
     * Check if running on simulator
     */
    private func isRunningOnSimulator() -> Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
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

        // Process actual camera capture or use mock for simulator
        if let capturedImage = info[UIImagePickerController.InfoKey.originalImage] as? UIImage {
            logger.debug("Processing actual camera capture")
            saveActualCameraImage(capturedImage)
        } else {
            logger.warning("No captured image found in info dictionary, using mock fallback")
            saveMockImage()
        }
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
