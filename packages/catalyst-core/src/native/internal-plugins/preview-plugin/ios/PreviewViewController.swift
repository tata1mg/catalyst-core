import UIKit
import WebKit

struct PreviewConfiguration {
    let url: URL
    let mode: String
    let edgeToEdge: Bool
    let splashEnabled: Bool
    let splashBackgroundColor: String
    let splashDuration: TimeInterval
}

/// Isolated, bridge-free browser surface for Preview and Docs modes.
///
/// Trust boundary properties, by construction:
/// - Fresh WKWebView with a non-persistent (ephemeral) data store: nothing is
///   shared with the trusted Catalyst WebView and nothing survives the session.
/// - No script message handlers or user scripts are ever registered.
/// - HTTPS-only top-level navigation; media-capture permission denied;
///   popups load in place or are dropped; external schemes require confirmation.
/// - WebContent process termination is recovered by reloading.
final class PreviewViewController: UIViewController {

    private let configuration: PreviewConfiguration
    private var webView: WKWebView?
    private let toolbar = UIView()
    private let expandPill = UIButton(type: .system)
    private let titleLabel = UILabel()
    private let backButton = UIButton(type: .system)
    private let forwardButton = UIButton(type: .system)
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private let errorLabel = UILabel()
    private let retryButton = UIButton(type: .system)
    private var splashOverlay: UIView?
    private var splashShownAt: Date?
    private var pageLoadedOnce = false
    private var terminationRecoveries = 0
    private var progressObservation: NSKeyValueObservation?

    private let maxTerminationRecoveries = 2

    private var initialHost: String { configuration.url.host ?? "" }
    private var isDocsMode: Bool { configuration.mode == PreviewPlugin.modeDocs }

    init(configuration: PreviewConfiguration) {
        self.configuration = configuration
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("PreviewViewController must be created in code")
    }

    deinit {
        progressObservation?.invalidate()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(white: 0.07, alpha: 1.0)

        buildToolbar()
        buildProgressBar()
        buildErrorViews()
        attachWebView()
        showSplashIfConfigured()
        loadInitialUrl()
    }

    // MARK: - UI construction

    private func buildToolbar() {
        toolbar.backgroundColor = UIColor(white: 0.07, alpha: 0.9)
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolbar)

        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 44),
        ])

        func toolbarButton(_ glyph: String, accessibility: String, action: Selector) -> UIButton {
            let button = UIButton(type: .system)
            button.setTitle(glyph, for: .normal)
            button.accessibilityLabel = accessibility
            button.setTitleColor(.white, for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 20, weight: .regular)
            button.addTarget(self, action: action, for: .touchUpInside)
            button.widthAnchor.constraint(equalToConstant: 44).isActive = true
            return button
        }

        let closeButton = toolbarButton("✕", accessibility: "Close preview", action: #selector(closeTapped))
        backButton.setTitle("‹", for: .normal)
        backButton.accessibilityLabel = "Back"
        backButton.setTitleColor(.white, for: .normal)
        backButton.titleLabel?.font = .systemFont(ofSize: 24, weight: .regular)
        backButton.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
        backButton.widthAnchor.constraint(equalToConstant: 44).isActive = true
        forwardButton.setTitle("›", for: .normal)
        forwardButton.accessibilityLabel = "Forward"
        forwardButton.setTitleColor(.white, for: .normal)
        forwardButton.titleLabel?.font = .systemFont(ofSize: 24, weight: .regular)
        forwardButton.addTarget(self, action: #selector(forwardTapped), for: .touchUpInside)
        forwardButton.widthAnchor.constraint(equalToConstant: 44).isActive = true
        let reloadButton = toolbarButton("⟳", accessibility: "Reload", action: #selector(reloadTapped))
        let collapseButton = toolbarButton("⌃", accessibility: "Hide preview controls", action: #selector(collapseTapped))

        titleLabel.text = isDocsMode ? "Catalyst Docs" : initialHost
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 14)
        titleLabel.lineBreakMode = .byTruncatingTail

        expandPill.setTitle("⌄", for: .normal)
        expandPill.accessibilityLabel = "Show preview controls"
        expandPill.setTitleColor(.white, for: .normal)
        expandPill.backgroundColor = UIColor(white: 0.07, alpha: 0.8)
        expandPill.layer.cornerRadius = 20
        expandPill.isHidden = true
        expandPill.translatesAutoresizingMaskIntoConstraints = false
        expandPill.addTarget(self, action: #selector(expandTapped), for: .touchUpInside)
        view.addSubview(expandPill)
        NSLayoutConstraint.activate([
            expandPill.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            expandPill.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -8),
            expandPill.widthAnchor.constraint(equalToConstant: 40),
            expandPill.heightAnchor.constraint(equalToConstant: 40),
        ])

        let stack = UIStackView(arrangedSubviews: [closeButton, backButton, forwardButton, titleLabel, reloadButton, collapseButton])
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        toolbar.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: toolbar.topAnchor),
            stack.bottomAnchor.constraint(equalTo: toolbar.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor, constant: 4),
            stack.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor, constant: -4),
        ])
    }

    private func buildProgressBar() {
        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.trackTintColor = .clear
        view.addSubview(progressView)
        NSLayoutConstraint.activate([
            progressView.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func buildErrorViews() {
        errorLabel.textColor = .darkGray
        errorLabel.font = .systemFont(ofSize: 15)
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.isHidden = true
        errorLabel.translatesAutoresizingMaskIntoConstraints = false

        retryButton.setTitle("Retry", for: .normal)
        retryButton.isHidden = true
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        view.addSubview(errorLabel)
        view.addSubview(retryButton)
        NSLayoutConstraint.activate([
            errorLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            errorLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            errorLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            errorLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            retryButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            retryButton.topAnchor.constraint(equalTo: errorLabel.bottomAnchor, constant: 12),
        ])
    }

    // MARK: - WebView lifecycle

    private func makeWebViewConfiguration() -> WKWebViewConfiguration {
        let webConfiguration = WKWebViewConfiguration()
        // Ephemeral store: no cookies, caches, or storage persist, and nothing
        // is shared with the trusted Catalyst WebView.
        webConfiguration.websiteDataStore = .nonPersistent()
        webConfiguration.defaultWebpagePreferences.allowsContentJavaScript = true
        return webConfiguration
    }

    private func attachWebView() {
        let webView = WKWebView(frame: .zero, configuration: makeWebViewConfiguration())
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.backgroundColor = .white
        webView.isOpaque = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(webView, belowSubview: toolbar)

        // Full-bleed viewport: the page gets the real screen (including the
        // system-bar areas when edge-to-edge is on); controls float above it.
        let topAnchor = configuration.edgeToEdge
            ? view.topAnchor
            : view.safeAreaLayoutGuide.topAnchor
        let bottomAnchor = configuration.edgeToEdge
            ? view.bottomAnchor
            : view.safeAreaLayoutGuide.bottomAnchor
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            guard let self else { return }
            self.progressView.progress = Float(webView.estimatedProgress)
            self.progressView.isHidden = webView.estimatedProgress >= 1.0
        }

        self.webView = webView
    }

    private func teardownWebView() {
        progressObservation?.invalidate()
        progressObservation = nil
        webView?.removeFromSuperview()
        webView = nil
    }

    private func loadInitialUrl() {
        webView?.load(URLRequest(url: configuration.url))
    }

    private func updateToolbarState() {
        backButton.alpha = (webView?.canGoBack ?? false) ? 1.0 : 0.35
        forwardButton.alpha = (webView?.canGoForward ?? false) ? 1.0 : 0.35
    }

    private func showError(_ message: String) {
        errorLabel.text = message
        errorLabel.isHidden = false
        retryButton.isHidden = false
        maybeDismissSplash()
    }

    private func hideError() {
        errorLabel.isHidden = true
        retryButton.isHidden = true
    }

    // MARK: - Actions

    @objc private func closeTapped() {
        dismiss(animated: true)
    }

    @objc private func collapseTapped() {
        toolbar.isHidden = true
        progressView.isHidden = true
        expandPill.isHidden = false
    }

    @objc private func expandTapped() {
        toolbar.isHidden = false
        expandPill.isHidden = true
    }

    @objc private func backTapped() {
        if webView?.canGoBack == true {
            webView?.goBack()
        }
    }

    @objc private func forwardTapped() {
        if webView?.canGoForward == true {
            webView?.goForward()
        }
    }

    @objc private func reloadTapped() {
        hideError()
        webView?.reload()
    }

    @objc private func retryTapped() {
        hideError()
        if webView?.url == nil {
            loadInitialUrl()
        } else {
            webView?.reload()
        }
    }

    private func confirmExternalOpen(_ url: URL) {
        let alert = UIAlertController(
            title: "Leave preview?",
            message: "Open in another app:\n\(url.absoluteString)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Open", style: .default) { _ in
            UIApplication.shared.open(url)
        })
        present(alert, animated: true)
    }

    // MARK: - Splash

    private func showSplashIfConfigured() {
        guard configuration.splashEnabled else {
            return
        }
        let overlay = UIView()
        overlay.backgroundColor = Self.color(fromHex: configuration.splashBackgroundColor) ?? .white
        overlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(overlay)
        view.bringSubviewToFront(toolbar)
        view.bringSubviewToFront(expandPill)
        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        splashOverlay = overlay
        splashShownAt = Date()
        let duration = min(max(configuration.splashDuration, 0), 10)
        DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak self] in
            self?.maybeDismissSplash()
        }
    }

    private func maybeDismissSplash() {
        guard let overlay = splashOverlay else {
            return
        }
        let elapsed = splashShownAt.map { Date().timeIntervalSince($0) } ?? 0
        let duration = min(max(configuration.splashDuration, 0), 10)
        guard pageLoadedOnce || !errorLabel.isHidden else {
            return
        }
        guard elapsed >= duration else {
            DispatchQueue.main.asyncAfter(deadline: .now() + (duration - elapsed)) { [weak self] in
                self?.maybeDismissSplash()
            }
            return
        }
        splashOverlay = nil
        UIView.animate(withDuration: 0.2, animations: {
            overlay.alpha = 0
        }, completion: { _ in
            overlay.removeFromSuperview()
        })
    }

    private static func color(fromHex hex: String) -> UIColor? {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") {
            value.removeFirst()
        }
        guard value.count == 6, let rgb = UInt32(value, radix: 16) else {
            return nil
        }
        return UIColor(
            red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
            green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
            blue: CGFloat(rgb & 0xFF) / 255.0,
            alpha: 1.0
        )
    }
}

// MARK: - WKNavigationDelegate

extension PreviewViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        switch url.scheme?.lowercased() {
        case "https":
            if isDocsMode, navigationAction.targetFrame?.isMainFrame != false, url.host != initialHost {
                confirmExternalOpen(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        case "tel", "mailto", "sms":
            confirmExternalOpen(url)
            decisionHandler(.cancel)
        default:
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        progressView.isHidden = false
        hideError()
        updateToolbarState()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoadedOnce = true
        progressView.isHidden = true
        if !isDocsMode {
            titleLabel.text = webView.url?.host ?? initialHost
        }
        updateToolbarState()
        maybeDismissSplash()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        progressView.isHidden = true
        showError("Could not load page")
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        progressView.isHidden = true
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled {
            return
        }
        showError("Could not load \(webView.url?.host ?? initialHost)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        terminationRecoveries += 1
        if terminationRecoveries > maxTerminationRecoveries {
            showError("Preview stopped responding")
            return
        }
        webView.reload()
    }
}

// MARK: - WKUIDelegate

extension PreviewViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // No popup windows in preview: load HTTPS popup targets in place, drop the rest.
        if navigationAction.targetFrame == nil,
           let url = navigationAction.request.url,
           url.scheme?.lowercased() == "https" {
            webView.load(navigationAction.request)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
    }
}
