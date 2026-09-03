import Foundation
import UIKit

public final class CompanionPlugin: CatalystPlugin {
    public init() {}

    public func handle(command: String, data: Any?, bridge: PluginBridgeContext) {
        Task { @MainActor in
            CompanionPreviewSession.shared.handle(command: command, data: data, bridge: bridge)
        }
    }
}

@MainActor
private final class CompanionPreviewSession {
    static let shared = CompanionPreviewSession()

    private let openCommand = "openPreview"
    private let openedEvent = "onPreviewOpened"
    private let errorEvent = "onPreviewError"

    private var requestInFlight = false
    private static let resolveMinSeconds: TimeInterval = 0.55
    private var resolvingOverlay: UIView?
    private var previewURL: URL?
    private weak var webViewModel: WebViewModel?
    private var chrome: CompanionChromeController?

    func handle(command: String, data: Any?, bridge: PluginBridgeContext) {
        guard command == openCommand else {
            sendError(bridge, "Unsupported command: \(command)", "UNSUPPORTED_COMMAND")
            return
        }
        guard previewURL == nil else {
            sendError(bridge, "Exit the current preview before opening another", "PREVIEW_ACTIVE")
            return
        }
        guard !requestInFlight else {
            sendError(bridge, "A preview request is already open", "PREVIEW_FAILED")
            return
        }
        guard let payload = data as? [String: Any],
              let rawURL = payload["url"] as? String,
              let parsedURL = URL(string: rawURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let url = CompanionPreviewConfig.normalizedPreviewURL(parsedURL),
              let origin = CompanionPreviewConfig.origin(for: url),
              bridge.webView != nil,
              bridge.webViewModel != nil else {
            sendError(bridge, "A valid URL is required", "INVALID_URL")
            return
        }

        requestInFlight = true
        // The QR resolves instantly, so without this the screen sits dead until
        // the confirm alert appears and the scan feels like it did nothing.
        showResolving(origin: origin)
        let startedAt = Date()
        CompanionPreviewConfig.fetch(from: origin) { [weak self] config in
            // Hold the indicator briefly so a fast fetch still reads as a step
            // rather than a flash.
            let elapsed = Date().timeIntervalSince(startedAt)
            let hold = max(0, Self.resolveMinSeconds - elapsed)
            DispatchQueue.main.asyncAfter(deadline: .now() + hold) {
                Task { @MainActor in
                    guard let self else { return }
                    self.dismissResolving()
                    self.showConfirmation(url: url, origin: origin, config: config, bridge: bridge)
                }
            }
        }
    }

    /// Full-screen scrim with a spinner, shown while the runtime config loads.
    @MainActor
    private func showResolving(origin: URL) {
        dismissResolving()
        guard let window = keyWindow() else { return }

        let overlay = UIView(frame: window.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.backgroundColor = UIColor(red: 0.05, green: 0.05, blue: 0.086, alpha: 0.9)
        overlay.alpha = 0

        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false

        let spinner = UIActivityIndicatorView(style: .large)
        spinner.color = .white
        spinner.startAnimating()

        let title = UILabel()
        title.text = "Opening preview…"
        title.textColor = .white
        title.font = .systemFont(ofSize: 17, weight: .semibold)

        let subtitle = UILabel()
        subtitle.text = origin.absoluteString
        subtitle.textColor = UIColor.white.withAlphaComponent(0.62)
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 1
        subtitle.lineBreakMode = .byTruncatingMiddle

        stack.addArrangedSubview(spinner)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)
        stack.setCustomSpacing(18, after: spinner)
        stack.setCustomSpacing(6, after: title)

        overlay.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -32),
        ])

        window.addSubview(overlay)
        resolvingOverlay = overlay
        UIView.animate(withDuration: 0.16) { overlay.alpha = 1 }
    }

    @MainActor
    private func dismissResolving() {
        guard let overlay = resolvingOverlay else { return }
        resolvingOverlay = nil
        UIView.animate(withDuration: 0.14, animations: { overlay.alpha = 0 }) { _ in
            overlay.removeFromSuperview()
        }
    }

    private func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
    }

    private func showConfirmation(
        url: URL,
        origin: URL,
        config: CompanionPreviewConfig?,
        bridge: PluginBridgeContext
    ) {
        guard let presenter = topViewController() else {
            requestInFlight = false
            sendError(bridge, "Unable to present preview confirmation", "PREVIEW_FAILED")
            return
        }

        let configDescription = config == nil ? "Companion defaults" : "loaded"
        let alert = UIAlertController(
            title: "Open preview?",
            message: "Origin: \(origin.absoluteString)\nRuntime config: \(configDescription)\n\nThe loaded app receives full native bridge access.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.requestInFlight = false
            self?.sendError(bridge, "Preview cancelled", "PREVIEW_CANCELLED")
        })
        alert.addAction(UIAlertAction(title: "Open Preview", style: .default) { [weak self] _ in
            guard let self else { return }
            self.requestInFlight = false
            self.openPreview(url: url, origin: origin, config: config, bridge: bridge)
        })
        presenter.present(alert, animated: true)
    }

    private func openPreview(
        url: URL,
        origin: URL,
        config: CompanionPreviewConfig?,
        bridge: PluginBridgeContext
    ) {
        guard let model = bridge.webViewModel else {
            sendError(bridge, "WebView unavailable", "PREVIEW_FAILED")
            return
        }

        if let config {
            RuntimeConfig.install(config.values)
        } else {
            RuntimeConfig.clear()
        }
        let accessEnabled = RuntimeConfig.accessControlEnabled
        var allowedUrls = RuntimeConfig.allowedUrls
        let edgeToEdgeEnabled = RuntimeConfig.edgeToEdgeEnabled
        if accessEnabled {
            let originPattern = origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/*"
            if !allowedUrls.contains(originPattern) {
                allowedUrls.append(originPattern)
            }
        }

        URLWhitelistManager.shared.configure(enabled: accessEnabled, allowedUrls: allowedUrls)
        previewURL = url
        webViewModel = model
        guard attachChrome() else {
            URLWhitelistManager.shared.configure(
                enabled: ConfigConstants.accessControlEnabled,
                allowedUrls: ConfigConstants.allowedUrls
            )
            RuntimeConfig.clear()
            previewURL = nil
            webViewModel = nil
            sendError(bridge, "Unable to install preview controls", "PREVIEW_FAILED")
            return
        }
        bridge.callback(eventName: openedEvent, data: ["url": url.absoluteString])
        DispatchQueue.main.async {
            model.replaceWebView(url: url.absoluteString, edgeToEdgeEnabled: edgeToEdgeEnabled)
        }
    }

    private func attachChrome() -> Bool {
        detachChrome()
        guard let root = rootViewController() else { return false }
        let controller = CompanionChromeController { [weak self] in
            self?.showPreviewMenu()
        }
        root.addChild(controller)
        root.view.addSubview(controller.view)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: root.view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: root.view.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: root.view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: root.view.bottomAnchor),
        ])
        controller.didMove(toParent: root)
        controller.becomeFirstResponder()
        chrome = controller
        return true
    }

    private func showPreviewMenu() {
        guard previewURL != nil, let presenter = topViewController() else { return }
        let sheet = UIAlertController(
            title: "Preview running",
            message: previewURL?.absoluteString,
            preferredStyle: .actionSheet
        )
        sheet.addAction(UIAlertAction(title: "Exit Preview", style: .destructive) { [weak self] _ in
            self?.exitPreview()
        })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        if let popover = sheet.popoverPresentationController, let chrome {
            popover.sourceView = chrome.view
            popover.sourceRect = CGRect(
                x: chrome.view.bounds.midX,
                y: chrome.view.safeAreaInsets.top + 15,
                width: 1,
                height: 1
            )
        }
        presenter.present(sheet, animated: true)
    }

    private func exitPreview() {
        guard let model = webViewModel else {
            abandonPreview()
            return
        }
        URLWhitelistManager.shared.configure(
            enabled: ConfigConstants.accessControlEnabled,
            allowedUrls: ConfigConstants.allowedUrls
        )
        RuntimeConfig.clear()
        previewURL = nil
        model.restoreConfiguredWebView { [weak self] in
            self?.abandonPreview()
        }
    }

    private func abandonPreview() {
        RuntimeConfig.clear()
        previewURL = nil
        webViewModel = nil
        detachChrome()
    }

    private func detachChrome() {
        chrome?.willMove(toParent: nil)
        chrome?.view.removeFromSuperview()
        chrome?.removeFromParent()
        chrome = nil
    }

    private func rootViewController() -> UIViewController? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
    }

    private func topViewController() -> UIViewController? {
        var top = rootViewController()
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    private func sendError(_ bridge: PluginBridgeContext, _ message: String, _ code: String) {
        bridge.callback(eventName: errorEvent, data: ["message": message, "code": code])
    }
}

private final class CompanionChromeController: UIViewController {
    private let onMenu: () -> Void

    init(onMenu: @escaping () -> Void) {
        self.onMenu = onMenu
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var canBecomeFirstResponder: Bool { true }

    override func loadView() {
        let passthroughView = CompanionPassthroughView()
        passthroughView.backgroundColor = .clear

        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("Catalyst Companion · Preview", for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 12)
        button.backgroundColor = UIColor(white: 0.07, alpha: 0.85)
        button.accessibilityLabel = "Catalyst Companion Preview. Show preview options."
        button.addTarget(self, action: #selector(showMenu), for: .touchUpInside)
        passthroughView.addSubview(button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: passthroughView.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: passthroughView.trailingAnchor),
            button.topAnchor.constraint(equalTo: passthroughView.safeAreaLayoutGuide.topAnchor),
            button.heightAnchor.constraint(equalToConstant: 30),
        ])
        view = passthroughView
    }

    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake {
            onMenu()
        } else {
            super.motionEnded(motion, with: event)
        }
    }

    @objc private func showMenu() {
        onMenu()
    }
}

private final class CompanionPassthroughView: UIView {
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        subviews.contains { subview in
            !subview.isHidden &&
                subview.alpha > 0 &&
                subview.point(inside: subview.convert(point, from: self), with: event)
        }
    }
}
