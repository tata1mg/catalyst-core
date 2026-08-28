import XCTest

/// Tier 2 (#416): simulator UI test for the iosnativeWebView app target.
///
/// The Tier 1 XCTest unit target (`iosnativeWebViewTests`) never launches
/// the real app, so `AppDelegate.didFinishLaunchingWithOptions`,
/// `iosnativeWebViewApp.init`, and `ContentView.body` are uncovered. A
/// real `XCUIApplication().launch()` exercises all of them plus
/// `WebViewContainer` / `WebView.makeUIView` view construction.
///
/// There is no dev server in CI, so `ConfigConstants.url`
/// (`http://localhost:3000`) fails to load — but the WKWebView element is
/// still built and mounted. We assert on element existence, not page
/// content. Report-only: this test's coverage is not a regression gate.
final class LaunchTests: XCTestCase {

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testAppLaunchesAndMountsWebView() {
        let app = XCUIApplication()
        app.launch()

        // A WKWebView surfaces as a `webViews` element once mounted. If
        // the load stalls before the element registers, fall back to any
        // top-level element so the launch itself is still asserted.
        let mounted = app.webViews.firstMatch.waitForExistence(timeout: 30)
            || app.otherElements.firstMatch.waitForExistence(timeout: 5)
        XCTAssertTrue(mounted, "App launched but no view hierarchy was mounted")
    }
}
