import UIKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "KeyboardUtil")

/// Simple keyboard utility for iOS - mirrors Android KeyboardUtil
class KeyboardUtil: NSObject, ImageHandlerDelegate {
    private var originalHeight: CGFloat = 0
    private weak var webViewContainer: UIView?
    
    init(webViewContainer: UIView) {
        self.webViewContainer = webViewContainer
    }
    
    func initialize() {
        guard let container = webViewContainer else { return }
        
        // Store original height
        DispatchQueue.main.async {
            self.originalHeight = container.frame.height
        }
        
        // Setup keyboard notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillShow),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
    }
    
    @objc private func keyboardWillShow(notification: NSNotification) {
        guard let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let container = webViewContainer else { return }
        
        let keyboardHeight = keyboardFrame.height
        
        if keyboardHeight > 200 { // Same threshold as Android
            // Resize container
            var frame = container.frame
            frame.size.height = originalHeight - keyboardHeight
            container.frame = frame
        }
    }
    
    @objc private func keyboardWillHide(notification: NSNotification) {
        guard let container = webViewContainer else { return }
        
        // Restore original size
        var frame = container.frame
        frame.size.height = originalHeight
        container.frame = frame
    }
    
    func cleanup() {
        NotificationCenter.default.removeObserver(self)
    }
}
