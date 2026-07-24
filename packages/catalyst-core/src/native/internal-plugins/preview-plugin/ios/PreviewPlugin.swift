import Foundation
import UIKit

/// Launcher for the isolated Preview browser surface.
///
/// The plugin never hosts preview state itself: it validates the request,
/// resolves the active presentation controller, and presents
/// `PreviewViewController` full screen. The trusted Catalyst WKWebView is
/// left completely untouched. (The iOS framework file server starts lazily
/// and is not running unless large-file transport was used, so no server
/// shutdown is required here.)
final class PreviewPlugin: CatalystPlugin {
    private let commandOpenBrowser = "openBrowser"
    private let openedCallback = "onOpened"
    private let errorCallback = "onError"

    static let modePreview = "preview"
    static let modeDocs = "docs"

    func handle(command: String, data: Any?, bridge: PluginBridgeContext) {
        guard command == commandOpenBrowser else {
            sendError(bridge, message: "Unsupported command: \(command)", code: "UNSUPPORTED_COMMAND")
            return
        }

        let payload = data as? [String: Any] ?? [:]
        let rawUrl = (payload["url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard let url = URL(string: rawUrl),
              url.scheme?.lowercased() == "https",
              let host = url.host, !host.isEmpty else {
            sendError(bridge, message: "Preview requires a valid https:// URL", code: "INVALID_URL")
            return
        }

        let rawMode = ((payload["mode"] as? String) ?? Self.modePreview).lowercased()
        guard rawMode == Self.modePreview || rawMode == Self.modeDocs else {
            sendError(bridge, message: "Unsupported mode: \(rawMode)", code: "INVALID_MODE")
            return
        }

        let splash = payload["splash"] as? [String: Any] ?? [:]
        let configuration = PreviewConfiguration(
            url: url,
            mode: rawMode,
            edgeToEdge: payload["edgeToEdge"] as? Bool ?? false,
            splashEnabled: splash["enabled"] as? Bool ?? false,
            splashBackgroundColor: splash["backgroundColor"] as? String ?? "#ffffff",
            splashDuration: Self.milliseconds(splash["duration"]) ?? 1.0
        )

        DispatchQueue.main.async {
            guard let presenter = Self.resolvePresenter(from: bridge) else {
                self.sendError(
                    bridge,
                    message: "No active view controller available to present preview",
                    code: "PREVIEW_LAUNCH_FAILED"
                )
                return
            }

            let controller = PreviewViewController(configuration: configuration)
            controller.modalPresentationStyle = .fullScreen
            presenter.present(controller, animated: true)
            bridge.callback(eventName: self.openedCallback, data: [
                "url": url.absoluteString,
                "mode": rawMode,
            ])
        }
    }

    /// Plugin-local presentation resolver: the context's `viewController` is a
    /// detached host that cannot reliably present, but the WKWebView is in the
    /// window hierarchy — walk from its window to the top-most presented
    /// controller. Falls back to the active scene's key window.
    private static func resolvePresenter(from bridge: PluginBridgeContext) -> UIViewController? {
        var root = bridge.webView?.window?.rootViewController

        if root == nil {
            let scenes = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .sorted { left, right in
                    (left.activationState == .foregroundActive ? 0 : 1)
                        < (right.activationState == .foregroundActive ? 0 : 1)
                }
            root = scenes
                .flatMap { $0.windows }
                .first(where: { $0.isKeyWindow })?
                .rootViewController ?? scenes.first?.windows.first?.rootViewController
        }

        guard var top = root else {
            return nil
        }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }

    private static func milliseconds(_ value: Any?) -> TimeInterval? {
        if let number = value as? NSNumber {
            return number.doubleValue / 1000.0
        }
        return nil
    }

    private func sendError(_ bridge: PluginBridgeContext, message: String, code: String) {
        bridge.callback(eventName: errorCallback, data: [
            "message": message,
            "code": code,
        ])
    }
}
