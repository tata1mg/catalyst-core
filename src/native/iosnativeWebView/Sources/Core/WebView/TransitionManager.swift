import UIKit
import WebKit
import os

private let transitionLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "TransitionManager")

/// Manages native page transitions using a snapshot-overlay pattern.
///
/// Flow:
///   startTransition()  — captures a snapshotView of the current WebView, places it as an
///                        overlay on the key window covering the skeleton rendered by the router.
///   commitTransition() — animates the overlay out (slide or fade) to reveal the new page.
///   cancelTransition() — removes the overlay immediately without animating.
///
/// Safety timer: a DispatchWorkItem fires after `timeout` ms if commitTransition() was
///   never called. It force-removes the overlay and fires ON_TRANSITION_TIMEOUT to JS.
///
/// Thread safety: all public methods must be called on the main thread.
class TransitionManager {

    private weak var webView: WKWebView?
    private var overlayView: UIView?
    private var safetyItem: DispatchWorkItem?
    private var activeDuration: TimeInterval = 0.3
    private var activeType: String = "slide"
    private var activeDirection: String = "left"

    // Callback to fire JS events — injected by NativeBridge
    var onEvent: (String) -> Void = { _ in }

    init(webView: WKWebView) {
        self.webView = webView
    }

    // MARK: - Public API

    func startTransition(type: String, direction: String, duration: Int, timeout: Int) {
        // Cancel any orphaned transition first
        cancelTransitionInternal(notify: false)

        activeType = type
        activeDirection = direction
        activeDuration = Double(duration) / 1000.0

        guard let snapshot = captureSnapshot() else {
            transitionLogger.warning("startTransition — snapshot failed, transition skipped")
            return
        }

        guard let window = webView?.window ?? UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow })
            .first else {
            transitionLogger.warning("startTransition — no key window found")
            return
        }

        snapshot.frame = window.bounds
        snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(snapshot)
        overlayView = snapshot

        transitionLogger.debug("startTransition — overlay attached (type=\(type) direction=\(direction) duration=\(duration)ms timeout=\(timeout)ms)")

        // Arm safety timer
        let item = DispatchWorkItem { [weak self] in
            transitionLogger.warning("startTransition — safety timeout fired, force-removing overlay")
            self?.cancelTransitionInternal(notify: false)
            self?.onEvent("ON_TRANSITION_TIMEOUT")
        }
        safetyItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeout), execute: item)
    }

    func commitTransition() {
        guard let overlay = overlayView else {
            transitionLogger.warning("commitTransition — no active overlay, ignoring")
            return
        }

        disarmSafetyTimer()

        switch activeType {
        case "fade":
            animateFadeOut(overlay: overlay, duration: activeDuration)
        default:
            animateSlideOut(overlay: overlay, duration: activeDuration, direction: activeDirection)
        }
    }

    func cancelTransition() {
        cancelTransitionInternal(notify: true)
    }

    func cleanup() {
        cancelTransitionInternal(notify: false)
    }

    // MARK: - Private helpers

    private func captureSnapshot() -> UIView? {
        guard let webView else { return nil }
        // snapshotView is GPU-backed and fast — no bitmap copy needed on iOS
        return webView.snapshotView(afterScreenUpdates: false)
    }

    private func animateSlideOut(overlay: UIView, duration: TimeInterval, direction: String) {
        guard let window = overlay.superview else { return }
        let w = window.bounds.width
        let h = window.bounds.height

        let endTranslation: CGPoint
        switch direction {
        case "right": endTranslation = CGPoint(x: -w, y: 0)
        case "up":    endTranslation = CGPoint(x: 0,  y: h)
        case "down":  endTranslation = CGPoint(x: 0,  y: -h)
        default:      endTranslation = CGPoint(x: w,  y: 0)  // "left" — overlay slides out to the right
        }

        UIView.animate(
            withDuration: duration,
            delay: 0,
            options: [.curveEaseInOut],
            animations: {
                overlay.transform = CGAffineTransform(translationX: endTranslation.x, y: endTranslation.y)
            },
            completion: { [weak self] _ in
                self?.removeOverlay(overlay)
                self?.onEvent("ON_TRANSITION_COMMITTED")
            }
        )
    }

    private func animateFadeOut(overlay: UIView, duration: TimeInterval) {
        UIView.animate(
            withDuration: duration,
            delay: 0,
            options: [.curveEaseInOut],
            animations: {
                overlay.alpha = 0
            },
            completion: { [weak self] _ in
                self?.removeOverlay(overlay)
                self?.onEvent("ON_TRANSITION_COMMITTED")
            }
        )
    }

    private func cancelTransitionInternal(notify: Bool) {
        disarmSafetyTimer()
        if let overlay = overlayView {
            removeOverlay(overlay)
            if notify {
                onEvent("ON_TRANSITION_CANCELLED")
            }
        }
    }

    private func removeOverlay(_ overlay: UIView) {
        overlay.removeFromSuperview()
        if overlayView === overlay {
            overlayView = nil
        }
    }

    private func disarmSafetyTimer() {
        safetyItem?.cancel()
        safetyItem = nil
    }
}
