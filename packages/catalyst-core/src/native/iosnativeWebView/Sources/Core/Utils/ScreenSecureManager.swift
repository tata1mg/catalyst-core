// ScreenSecureManager.swift
// Manages screen security on iOS by overlaying a blank view when the app
// moves to the background — preventing the app switcher thumbnail from
// capturing sensitive content.
//
// iOS limitation: unlike Android FLAG_SECURE, iOS cannot block system or
// third-party screenshots. This only protects the app switcher snapshot.

import UIKit
import os

private let secureLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "ScreenSecureManager")

final class ScreenSecureManager {

    public static let shared = ScreenSecureManager()
    private init() {
        setupSceneObservers()
    }

    // Track whether screen security is requested by the web layer
    private(set) var isScreenSecure: Bool = false

    // The overlay view installed over the window when backgrounding
    private var overlayWindow: UIWindow?
    // Guard flag set before async dispatch to prevent double-install race
    private var overlayInstalling: Bool = false

    // MARK: - Public API

    /// Enable or disable screen-secure mode.
    /// When enabled, a blank overlay is shown whenever the app moves to background
    /// so the app-switcher snapshot does not capture sensitive content.
    func setScreenSecure(_ enable: Bool) {
        isScreenSecure = enable
        secureLogger.debug("setScreenSecure called: enable=\(enable)")
        if !enable {
            removeOverlay()
        }
        // If enabling while already in background, install immediately
        if enable && UIApplication.shared.applicationState == .background {
            secureLogger.debug("setScreenSecure: app already in background, installing overlay immediately")
            installOverlay()
        }
    }

    // MARK: - Scene lifecycle

    private func setupSceneObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(sceneWillDeactivate),
            name: UIScene.willDeactivateNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(sceneDidActivate),
            name: UIScene.didActivateNotification,
            object: nil
        )
    }

    @objc private func sceneWillDeactivate() {
        secureLogger.debug("sceneWillDeactivate fired: isScreenSecure=\(self.isScreenSecure)")
        guard isScreenSecure else { return }
        installOverlay()
    }

    @objc private func sceneDidActivate() {
        secureLogger.debug("sceneDidActivate fired — removing overlay")
        removeOverlay()
    }

    // MARK: - Overlay management

    private func installOverlay() {
        // Set flag before async dispatch to prevent double-install race
        guard overlayWindow == nil && !overlayInstalling else {
            secureLogger.debug("installOverlay: skipped (already installing or installed)")
            return
        }
        overlayInstalling = true
        secureLogger.debug("installOverlay: dispatching to main thread")

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            defer { self.overlayInstalling = false }

            // Accept foregroundInactive too — that's the state during the
            // willDeactivate transition on both simulator and device.
            guard let scene = UIApplication.shared.connectedScenes
                .first(where: {
                    $0.activationState == .foregroundActive ||
                    $0.activationState == .foregroundInactive ||
                    $0.activationState == .background
                })
                as? UIWindowScene else {
                secureLogger.error("installOverlay: no suitable UIWindowScene found — overlay NOT installed")
                return
            }

            secureLogger.debug("installOverlay: scene found (state=\(String(describing: scene.activationState.rawValue))), creating overlay window")

            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.backgroundColor = .black
            window.rootViewController = UIViewController()
            window.rootViewController?.view.backgroundColor = .black
            window.isHidden = false

            self.overlayWindow = window
            secureLogger.debug("installOverlay: overlay window installed successfully")
        }
    }

    private func removeOverlay() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.overlayWindow != nil {
                secureLogger.debug("removeOverlay: hiding and releasing overlay window")
            }
            self.overlayWindow?.isHidden = true
            self.overlayWindow = nil
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
