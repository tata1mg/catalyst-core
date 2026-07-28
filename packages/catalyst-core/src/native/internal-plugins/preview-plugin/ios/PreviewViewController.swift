import UIKit
import WebKit

struct PreviewConfiguration {
    let url: URL
    let edgeToEdge: Bool
    let splashEnabled: Bool
    let splashBackgroundColor: String
    let splashDuration: TimeInterval
}

/// Shared URL policy for the preview surface, used by both the launcher
/// (`PreviewPlugin`) and the per-navigation check below so the two can never
/// drift apart. Declared here alongside `PreviewConfiguration`, which the two
/// files already share.
///
/// The rule: `https` is allowed for any host; cleartext `http` is allowed only
/// for private-network hosts, which is what makes dev-server previews
/// (`http://192.168.1.80:5173`) work without weakening anything public.
enum PreviewUrlPolicy {

    /// True when `url` may be loaded as a top-level preview navigation.
    static func isAllowedPreviewUrl(_ url: URL) -> Bool {
        guard let host = url.host, !host.isEmpty else {
            return false
        }
        switch url.scheme?.lowercased() {
        case "https":
            return true
        case "http":
            return isPrivateHost(host)
        default:
            return false
        }
    }

    /// True for hosts that can only live on the local machine or the local
    /// network: "localhost", any ".local" mDNS name, IPv4 loopback (127/8),
    /// the RFC1918 ranges (10/8, 172.16/12, 192.168/16), and link-local
    /// (169.254/16). Any other hostname — including one that merely looks like
    /// an address, e.g. "10.0.0.5.evil.com" — is treated as public.
    static func isPrivateHost(_ rawHost: String) -> Bool {
        // A trailing dot is a legal FQDN root; strip it before comparing.
        var host = rawHost.lowercased()
        if host.hasSuffix(".") {
            host.removeLast()
        }
        if host == "localhost" || host.hasSuffix(".local") {
            return true
        }

        guard let octets = parseIPv4(host) else {
            return false
        }
        switch (octets[0], octets[1]) {
        case (127, _), (10, _):
            return true
        case (172, 16...31), (192, 168), (169, 254):
            return true
        default:
            return false
        }
    }

    /// Strict dotted-quad parse: exactly four decimal octets in 0...255.
    /// Anything looser (hex forms, missing or extra parts, out-of-range values
    /// such as "1721.6.0.1") returns nil rather than being coerced into an
    /// address.
    private static func parseIPv4(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else {
            return nil
        }
        var octets: [Int] = []
        octets.reserveCapacity(4)
        for part in parts {
            guard !part.isEmpty, part.count <= 3,
                  part.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let value = Int(part), value <= 255 else {
                return nil
            }
            octets.append(value)
        }
        return octets
    }
}

/// Isolated, bridge-free surface for previewing external apps.
///
/// Presentation is chrome-less by design — exactly like the trusted Catalyst
/// WebView, the page IS the screen. There is no toolbar, URL display, or
/// progress bar. Edge swipes walk page history; shaking the device opens a
/// native menu (Reload / Close Preview) — the established dev-tool escape
/// hatch on iOS, where a full-screen modal has no system back. A fading hint
/// pill teaches the gesture once per session; failed loads show an error
/// state with Retry/Close.
///
/// Trust boundary properties, by construction:
/// - Fresh WKWebView with a non-persistent (ephemeral) data store: nothing is
///   shared with the trusted Catalyst WebView and nothing survives the session.
/// - No script message handlers or user scripts are ever registered.
/// - Top-level navigation is https for public hosts, plus cleartext http for
///   private-network hosts (localhost, *.local, RFC1918, link-local) so a dev
///   server can be previewed. That is safe here because this surface has its
///   own ephemeral data store and no bridge, and trusting the LAN path is
///   exactly the trust already placed in the dev server being previewed.
/// - Media-capture permission denied; popups load in place or are dropped;
///   external schemes require confirmation.
/// - WebContent process termination is recovered by reloading.
final class PreviewViewController: UIViewController {

    private let configuration: PreviewConfiguration
    private var webView: WKWebView?
    private let errorLabel = UILabel()
    private let retryButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let hintLabel = UILabel()
    private var splashOverlay: UIView?
    private var splashShownAt: Date?
    private var pageLoadedOnce = false
    private var terminationRecoveries = 0
    private var hintShown = false

    private let maxTerminationRecoveries = 2

    private var initialHost: String { configuration.url.host ?? "" }

    init(configuration: PreviewConfiguration) {
        self.configuration = configuration
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("PreviewViewController must be created in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(white: 0.07, alpha: 1.0)

        buildErrorViews()
        attachWebView()
        showSplashIfConfigured()
        buildHintLabel()
        loadInitialUrl()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // First responder is required to receive shake motion events.
        becomeFirstResponder()
        showHintOnce()
    }

    override var canBecomeFirstResponder: Bool { true }

    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        guard motion == .motionShake else {
            super.motionEnded(motion, with: event)
            return
        }
        presentPreviewMenu()
    }

    // MARK: - Preview menu (shake gesture)

    private func presentPreviewMenu() {
        guard presentedViewController == nil else {
            return
        }
        let sheet = UIAlertController(
            title: initialHost,
            message: nil,
            preferredStyle: .actionSheet
        )
        sheet.addAction(UIAlertAction(title: "Reload", style: .default) { [weak self] _ in
            self?.hideError()
            self?.webView?.reload()
        })
        sheet.addAction(UIAlertAction(title: "Close Preview", style: .destructive) { [weak self] _ in
            self?.dismiss(animated: true)
        })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        // iPad requires a popover anchor for action sheets.
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(
            x: view.bounds.midX,
            y: view.bounds.midY,
            width: 0,
            height: 0
        )
        present(sheet, animated: true)
    }

    // MARK: - UI construction

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

        closeButton.setTitle("Close preview", for: .normal)
        closeButton.setTitleColor(.systemRed, for: .normal)
        closeButton.isHidden = true
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        view.addSubview(errorLabel)
        view.addSubview(retryButton)
        view.addSubview(closeButton)
        NSLayoutConstraint.activate([
            errorLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            errorLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            errorLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            errorLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            retryButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            retryButton.topAnchor.constraint(equalTo: errorLabel.bottomAnchor, constant: 12),
            closeButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            closeButton.topAnchor.constraint(equalTo: retryButton.bottomAnchor, constant: 8),
        ])
    }

    private func buildHintLabel() {
        hintLabel.text = "Shake for preview options"
        hintLabel.textColor = .white
        hintLabel.font = .systemFont(ofSize: 13, weight: .medium)
        hintLabel.textAlignment = .center
        hintLabel.backgroundColor = UIColor(white: 0.07, alpha: 0.8)
        hintLabel.layer.cornerRadius = 15
        hintLabel.layer.masksToBounds = true
        hintLabel.alpha = 0
        hintLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hintLabel)
        NSLayoutConstraint.activate([
            hintLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hintLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            hintLabel.heightAnchor.constraint(equalToConstant: 30),
            hintLabel.widthAnchor.constraint(equalToConstant: 210),
        ])
    }

    private func showHintOnce() {
        guard !hintShown else {
            return
        }
        hintShown = true
        view.bringSubviewToFront(hintLabel)
        UIView.animate(withDuration: 0.3) {
            self.hintLabel.alpha = 1
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { [weak self] in
            guard let self else { return }
            UIView.animate(withDuration: 0.5, animations: {
                self.hintLabel.alpha = 0
            }, completion: { _ in
                self.hintLabel.removeFromSuperview()
            })
        }
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
        view.insertSubview(webView, at: 0)

        // Full-bleed viewport: the page gets the real screen (including the
        // system-bar areas when edge-to-edge is on).
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

        self.webView = webView
    }

    private func teardownWebView() {
        webView?.removeFromSuperview()
        webView = nil
    }

    private func loadInitialUrl() {
        webView?.load(URLRequest(url: configuration.url))
    }

    private func showError(_ message: String) {
        errorLabel.text = message
        errorLabel.isHidden = false
        retryButton.isHidden = false
        closeButton.isHidden = false
        view.backgroundColor = .white
        maybeDismissSplash()
    }

    private func hideError() {
        errorLabel.isHidden = true
        retryButton.isHidden = true
        closeButton.isHidden = true
        view.backgroundColor = UIColor(white: 0.07, alpha: 1.0)
    }

    // MARK: - Actions

    @objc private func closeTapped() {
        dismiss(animated: true)
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

        // Re-checked per navigation, not just at launch: a cleartext dev page
        // must not be able to walk the preview to http://public.com.
        if PreviewUrlPolicy.isAllowedPreviewUrl(url) {
            decisionHandler(.allow)
            return
        }

        switch url.scheme?.lowercased() {
        case "tel", "mailto", "sms":
            confirmExternalOpen(url)
            decisionHandler(.cancel)
        default:
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        hideError()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoadedOnce = true
        maybeDismissSplash()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError("Could not load page")
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
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
        // No popup windows in preview: load allowed popup targets in place
        // (same policy as a top-level navigation), drop the rest.
        if navigationAction.targetFrame == nil,
           let url = navigationAction.request.url,
           PreviewUrlPolicy.isAllowedPreviewUrl(url) {
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
