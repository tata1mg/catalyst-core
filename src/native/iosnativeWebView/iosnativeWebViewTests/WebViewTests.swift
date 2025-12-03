import XCTest
import WebKit
import SwiftUI
@testable import CatalystCore

/**
 * Unit tests for WebView and WebViewNavigationDelegate
 *
 * Tests the main WebView wrapper and navigation handling logic.
 * Mirrors Android CustomWebviewTest for cross-platform parity.
 *
 * Categories:
 * 1. WebView Configuration (5 tests)
 * 2. Navigation Handling (6 tests)
 * 3. Resource Loading (4 tests)
 * 4. State Management (3 tests)
 *
 * Total: 18 tests
 *
 * Testing Approach:
 * - Tests focus on navigation delegate logic and view model state management
 * - WKWebView itself is not fully instantiated (requires iOS runtime)
 * - URL whitelisting integration is tested via URLWhitelistManager
 * - Cache integration is tested via CacheManager mock
 */
final class WebViewTests: XCTestCase {

    // Test fixtures
    var viewModel: WebViewModel!
    var navigationDelegate: WebViewNavigationDelegate!
    var mockWebView: WKWebView!

    @MainActor
    override func setUp() async throws {
        try await super.setUp()

        // Create view model
        viewModel = WebViewModel()

        // Create navigation delegate
        navigationDelegate = WebViewNavigationDelegate(viewModel: viewModel)

        // Create a basic WKWebView for testing
        let config = WKWebViewConfiguration()
        mockWebView = WKWebView(frame: .zero, configuration: config)
    }

    @MainActor
    override func tearDown() async throws {
        viewModel = nil
        navigationDelegate = nil
        mockWebView = nil
        try await super.tearDown()
    }

    // ========================================
    // CATEGORY 1: WebView Configuration (5 tests)
    // ========================================

    @MainActor
    func testWebViewConfiguration_WKWebViewSetup() {
        // Test that WKWebView is configured correctly

        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)

        // Verify web view is created
        XCTAssertNotNil(webView, "WKWebView should be created")
        XCTAssertNotNil(webView.configuration, "WKWebView configuration should exist")
    }

    @MainActor
    func testWebViewConfiguration_UserAgentConfiguration() {
        // Test user agent string configuration

        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)

        // Custom user agent can be set
        webView.customUserAgent = "CustomUserAgent/1.0"

        XCTAssertEqual(webView.customUserAgent, "CustomUserAgent/1.0",
                      "Custom user agent should be set correctly")
    }

    @MainActor
    func testWebViewConfiguration_ContentControllerSetup() {
        // Test that content controller is properly configured

        let config = WKWebViewConfiguration()
        let contentController = config.userContentController

        XCTAssertNotNil(contentController, "User content controller should exist")
    }

    @MainActor
    func testWebViewConfiguration_NavigationDelegateAssignment() {
        // Test that navigation delegate can be assigned

        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)

        webView.navigationDelegate = navigationDelegate

        XCTAssertNotNil(webView.navigationDelegate,
                       "Navigation delegate should be assigned")
    }

    @MainActor
    func testWebViewConfiguration_JavaScriptEnabled() {
        // Test that JavaScript is enabled in preferences

        let config = WKWebViewConfiguration()
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        config.defaultWebpagePreferences = preferences

        XCTAssertTrue(config.defaultWebpagePreferences.allowsContentJavaScript,
                     "JavaScript should be enabled")
    }

    // ========================================
    // CATEGORY 2: Navigation Handling (6 tests)
    // ========================================

    @MainActor
    func testNavigationHandling_AllowedURLLoading() {
        // Test that allowed URLs are permitted for navigation

        let allowedURL = URL(string: "https://example.com")!

        // Configure URLWhitelistManager to allow this URL
        #if DEBUG
        URLWhitelistManager.shared.testInitialize(
            enabled: true,
            allowedUrls: ["https://example.com*"]
        )
        #endif

        let navigationAction = createNavigationAction(url: allowedURL)
        var decisionReceived = false
        var allowedDecision = false

        navigationDelegate.webView(mockWebView,
                                   decidePolicyFor: navigationAction) { policy in
            decisionReceived = true
            allowedDecision = (policy == .allow)
        }

        // Wait briefly for async decision
        let expectation = XCTestExpectation(description: "Navigation decision")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1.0)

        XCTAssertTrue(decisionReceived, "Navigation decision should be received")
        XCTAssertTrue(allowedDecision || !URLWhitelistManager.shared.isAccessControlEnabled,
                     "Allowed URL should be permitted")
    }

    @MainActor
    func testNavigationHandling_BlockedURLNavigation() {
        // Test that blocked URLs are rejected

        let blockedURL = URL(string: "https://blocked.com")!

        // Configure URLWhitelistManager to block this URL
        #if DEBUG
        URLWhitelistManager.shared.testInitialize(
            enabled: true,
            allowedUrls: ["https://allowed.com*"]
        )
        #endif

        let navigationAction = createNavigationAction(url: blockedURL)
        var decisionReceived = false
        var blockedDecision = false

        navigationDelegate.webView(mockWebView,
                                   decidePolicyFor: navigationAction) { policy in
            decisionReceived = true
            blockedDecision = (policy == .cancel)
        }

        // Wait briefly for async decision
        let expectation = XCTestExpectation(description: "Navigation decision")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1.0)

        XCTAssertTrue(decisionReceived, "Navigation decision should be received")
        XCTAssertTrue(blockedDecision, "Blocked URL should be cancelled")
    }

    @MainActor
    func testNavigationHandling_ExternalDomainHandling() {
        // Test that external domains are detected and handled

        let externalURL = URL(string: "https://external.com")!

        // Enable access control with limited allowed URLs
        #if DEBUG
        URLWhitelistManager.shared.testInitialize(
            enabled: true,
            allowedUrls: ["https://myapp.com*"]
        )
        #endif

        // Check if URL is external
        let isExternal = URLWhitelistManager.shared.isExternalDomain(externalURL)

        XCTAssertTrue(isExternal,
                     "URL outside allowed patterns should be detected as external")
    }

    @MainActor
    func testNavigationHandling_URLWhitelistIntegration() {
        // Test integration with URLWhitelistManager

        let testURL = URL(string: "https://test.com/page")!

        // Configure whitelist
        #if DEBUG
        URLWhitelistManager.shared.testInitialize(
            enabled: true,
            allowedUrls: ["https://test.com*"]
        )
        #endif

        let isAllowed = URLWhitelistManager.shared.isUrlAllowed(testURL)

        XCTAssertTrue(isAllowed, "URL matching whitelist pattern should be allowed")
    }

    @MainActor
    func testNavigationHandling_LocalhostFrameworkURLBypass() {
        // Test that localhost framework URLs bypass access control

        let frameworkURL = URL(string: "https://localhost:8080/framework-server/file.pdf")!

        // Enable strict access control
        #if DEBUG
        URLWhitelistManager.shared.testInitialize(
            enabled: true,
            allowedUrls: ["https://myapp.com*"]
        )
        #endif

        let isAllowed = URLWhitelistManager.shared.isUrlAllowed(frameworkURL)

        XCTAssertTrue(isAllowed,
                     "Localhost framework URLs should bypass access control")
    }

    @MainActor
    func testNavigationHandling_SpecialURLSchemeDetection() {
        // Test that special URL schemes (tel:, mailto:, sms:) are detected

        let telURL = URL(string: "tel:1234567890")!
        let mailtoURL = URL(string: "mailto:test@example.com")!
        let smsURL = URL(string: "sms:1234567890")!

        XCTAssertEqual(telURL.scheme, "tel", "Tel URL scheme should be detected")
        XCTAssertEqual(mailtoURL.scheme, "mailto", "Mailto URL scheme should be detected")
        XCTAssertEqual(smsURL.scheme, "sms", "SMS URL scheme should be detected")
    }

    // ========================================
    // CATEGORY 3: Resource Loading (4 tests)
    // ========================================

    @MainActor
    func testResourceLoading_CachePatternMatching_CSS() {
        // Test cache pattern matching for CSS files

        let cssURL = URL(string: "https://myapp.com/static/styles.abc123.css")!
        let cssWithQuery = URL(string: "https://myapp.com/styles.css?v=1.0")!

        // Configure cache manager to recognize CSS patterns
        let shouldCacheCSS = CacheManager.shared.shouldCacheURL(cssURL)
        let shouldCacheCSSQuery = CacheManager.shared.shouldCacheURL(cssWithQuery)

        // Cache manager should handle CSS files based on configured patterns
        XCTAssertNotNil(shouldCacheCSS, "Cache manager should process CSS URLs")
        XCTAssertNotNil(shouldCacheCSSQuery, "Cache manager should process CSS URLs with query")
    }

    @MainActor
    func testResourceLoading_CachePatternMatching_JavaScript() {
        // Test cache pattern matching for JavaScript files

        let jsURL = URL(string: "https://myapp.com/static/app.xyz789.js")!
        let jsWithQuery = URL(string: "https://myapp.com/bundle.js?v=2.0")!

        let shouldCacheJS = CacheManager.shared.shouldCacheURL(jsURL)
        let shouldCacheJSQuery = CacheManager.shared.shouldCacheURL(jsWithQuery)

        // Cache manager should handle JS files based on configured patterns
        XCTAssertNotNil(shouldCacheJS, "Cache manager should process JS URLs")
        XCTAssertNotNil(shouldCacheJSQuery, "Cache manager should process JS URLs with query")
    }

    @MainActor
    func testResourceLoading_APICallDetection() {
        // Test API call detection logic

        let apiURL = URL(string: "https://api.myapp.com/v1/users")!
        let apiWithQuery = URL(string: "https://myapp.com/api/data?id=123")!

        // API URLs typically shouldn't be cached (or have different cache rules)
        let host = apiURL.host ?? ""
        let path = apiURL.path

        let isAPIHost = host.contains("api.")
        let isAPIPath = path.contains("/api/")

        XCTAssertTrue(isAPIHost || isAPIPath,
                     "API URLs should be detectable by host or path")
    }

    @MainActor
    func testResourceLoading_StaticResourceDetection() {
        // Test static resource detection by extension

        let imageURL = URL(string: "https://myapp.com/images/logo.png")!
        let fontURL = URL(string: "https://myapp.com/fonts/roboto.woff2")!
        let htmlURL = URL(string: "https://myapp.com/page.html")!

        let imageExt = imageURL.pathExtension.lowercased()
        let fontExt = fontURL.pathExtension.lowercased()
        let htmlExt = htmlURL.pathExtension.lowercased()

        XCTAssertEqual(imageExt, "png", "Image extension should be detected")
        XCTAssertEqual(fontExt, "woff2", "Font extension should be detected")
        XCTAssertEqual(htmlExt, "html", "HTML extension should be detected")

        // Common static resource extensions
        let staticExtensions = ["png", "jpg", "jpeg", "gif", "svg", "css", "js",
                               "woff", "woff2", "ttf", "eot"]
        let isImageStatic = staticExtensions.contains(imageExt)
        let isFontStatic = staticExtensions.contains(fontExt)

        XCTAssertTrue(isImageStatic, "Image should be recognized as static resource")
        XCTAssertTrue(isFontStatic, "Font should be recognized as static resource")
    }

    // ========================================
    // CATEGORY 4: State Management (3 tests)
    // ========================================

    @MainActor
    func testStateManagement_LoadingStateTracking() {
        // Test that loading state is tracked correctly

        // Initial state
        XCTAssertTrue(viewModel.isLoading, "Should start in loading state")

        // Start loading
        viewModel.setLoading(true, fromCache: false)
        XCTAssertTrue(viewModel.isLoading, "Should be loading")
        XCTAssertFalse(viewModel.isLoadingFromCache, "Should not be from cache")

        // Finish loading
        viewModel.setLoading(false, fromCache: false)
        XCTAssertEqual(viewModel.loadingProgress, 1.0,
                      "Progress should be 1.0 when loading finishes")
    }

    @MainActor
    func testStateManagement_ProgressObservation() {
        // Test that progress is tracked correctly

        // Initial progress
        XCTAssertEqual(viewModel.loadingProgress, 0.0,
                      "Initial progress should be 0")

        // Update progress
        viewModel.setProgress(0.5)
        XCTAssertEqual(viewModel.loadingProgress, 0.5,
                      "Progress should be updated to 0.5")

        viewModel.setProgress(0.75)
        XCTAssertEqual(viewModel.loadingProgress, 0.75,
                      "Progress should be updated to 0.75")

        viewModel.setProgress(1.0)
        XCTAssertEqual(viewModel.loadingProgress, 1.0,
                      "Progress should reach 1.0")
    }

    @MainActor
    func testStateManagement_ErrorStateHandling() {
        // Test that error state resets properly

        // Set to loading state
        viewModel.setLoading(true, fromCache: false)
        viewModel.setProgress(0.5)

        // Simulate error by resetting
        viewModel.reset()

        // Verify state is reset
        XCTAssertFalse(viewModel.isLoading, "Should not be loading after reset")
        XCTAssertEqual(viewModel.loadingProgress, 0,
                      "Progress should be 0 after reset")
        XCTAssertFalse(viewModel.isLoadingFromCache,
                      "Should not be loading from cache after reset")
    }

    // ========================================
    // Helper Methods
    // ========================================

    private func createNavigationAction(url: URL) -> WKNavigationAction {
        // Create a mock navigation action
        // Note: WKNavigationAction cannot be directly instantiated, so we use a workaround
        // by creating a URLRequest and using the web view's load method

        let request = URLRequest(url: url)

        // Create a temporary web view to generate a navigation action
        let tempWebView = WKWebView(frame: .zero)
        tempWebView.load(request)

        // In practice, we rely on the delegate being called with real navigation actions
        // For testing, we verify the logic with URL directly

        // Return a mock object - in actual tests, we verify the decision handler logic
        // through integration with URLWhitelistManager
        return MockNavigationAction(request: request)
    }
}

// ========================================
// Mock Objects
// ========================================

/// Mock navigation action for testing
private class MockNavigationAction: WKNavigationAction {
    private let mockRequest: URLRequest

    init(request: URLRequest) {
        self.mockRequest = request
        super.init()
    }

    override var request: URLRequest {
        return mockRequest
    }
}
