import SwiftUI
import WebKit
import CatalystCoreLogic

/// Decoded public/splashscreen.html, embedded as base64 by the iOS build.
/// nil when the app has no HTML splash (or the payload can't be decoded).
enum SplashHTML {
    static let content: String? = ConfigConstants.splashScreenHtml
        .flatMap { Data(base64Encoded: $0) }
        .flatMap { String(data: $0, encoding: .utf8) }
}

/// Non-interactive, transparent WKWebView that renders the HTML splash above the native splash image.
struct SplashHTMLView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isUserInteractionEnabled = false

        if let html = SplashHTML.content {
            webView.loadHTMLString(html, baseURL: nil)
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
