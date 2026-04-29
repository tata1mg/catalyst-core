import XCTest
@testable import CatalystCore

/// Unit tests for URLWhitelistManager
/// Tests pattern matching, access control, URL cleaning, and thread safety
///
/// This test suite mirrors the Android URLWhitelistManagerTest for consistency
final class URLWhitelistManagerTests: XCTestCase {

    // Store original values to restore after tests
    private var originalAccessControl: Bool = false
    private var originalAllowedUrls: [String] = []

    override func setUp() {
        super.setUp()
        // Store original configuration
        originalAccessControl = ConfigConstants.accessControlEnabled
        originalAllowedUrls = ConfigConstants.allowedUrls
    }

    override func tearDown() {
        // Restore original configuration after each test
        setConfigConstants(enabled: originalAccessControl, allowedUrls: originalAllowedUrls)
        super.tearDown()
    }

    /// Helper to set ConfigConstants for testing
    /// Note: Since ConfigConstants is dynamically generated, we use URLWhitelistManager's test initialization
    private func setConfigConstants(enabled: Bool, allowedUrls: [String]) {
        URLWhitelistManager.shared.testInitialize(enabled: enabled, allowedUrls: allowedUrls)
    }

    // ============================================================
    // Test 1: Access Control Enabled/Disabled
    // ============================================================

    func testAccessControlDisabledAllowsAllURLs() {
        setConfigConstants(enabled: false, allowedUrls: ["https://example.com/*"])

        // Even though only example.com is in patterns, all URLs should be allowed
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://google.com"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://evil.com"))
        XCTAssertFalse(URLWhitelistManager.shared.isAccessControlEnabled)
    }

    func testAccessControlEnabledBlocksNonWhitelistedURLs() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/*"])

        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://google.com"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://evil.com"))
        XCTAssertTrue(URLWhitelistManager.shared.isAccessControlEnabled)
    }

    func testIsExternalDomainWithAccessControlDisabled() {
        setConfigConstants(enabled: false, allowedUrls: ["https://example.com/*"])

        // Nothing is external when access control is disabled
        XCTAssertFalse(URLWhitelistManager.shared.isExternalDomain("https://google.com"))
        XCTAssertFalse(URLWhitelistManager.shared.isExternalDomain("https://evil.com"))
    }

    func testIsExternalDomainWithAccessControlEnabled() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/*"])

        XCTAssertFalse(URLWhitelistManager.shared.isExternalDomain("https://example.com/page"))
        XCTAssertTrue(URLWhitelistManager.shared.isExternalDomain("https://google.com"))
        XCTAssertTrue(URLWhitelistManager.shared.isExternalDomain("https://evil.com"))
    }

    // ============================================================
    // Test 2: Pattern Matching - Contains (*text* or text)
    // ============================================================

    func testContainsPatternWithWildcardsOnBothSides() {
        setConfigConstants(enabled: true, allowedUrls: ["*.1mg.com*"])

        // Should match any URL containing ".1mg.com"
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://stagpsppfizer.1mg.com:443/"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://www.1mg.com/products"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://api.1mg.com/v1/users"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://subdomain.1mg.com/anything"))

        // Should NOT match (1mg.com not in the domain part)
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://evil.com/phishing?redirect=1mg.com"))
    }

    func testContainsPatternWithoutWildcards() {
        setConfigConstants(enabled: true, allowedUrls: ["1mg.com"])

        // Should match any URL containing "1mg.com" (same as *.1mg.com*)
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://www.1mg.com/products"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://api.1mg.com/v1/users"))

        // This is developer responsibility - pattern is too broad
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://evil.1mg.com.attacker.com/"))
    }

    func testMultipleContainsPatterns() {
        setConfigConstants(enabled: true, allowedUrls: [
            "*browser.sentry-cdn.com/*",
            "*.1mg.com*"
        ])

        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://browser.sentry-cdn.com/bundle.js"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://www.1mg.com/products"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://google.com"))
    }

    // ============================================================
    // Test 3: Pattern Matching - Prefix (text*)
    // ============================================================

    func testPrefixPatternMatchesURLsStartingWithPattern() {
        setConfigConstants(enabled: true, allowedUrls: [
            "https://onemg.gumlet.io/*",
            "https://stagpsppfizer.1mg.com/*"
        ])

        // Should match URLs starting with the pattern
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://onemg.gumlet.io/images/test.png"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://onemg.gumlet.io/videos/demo.mp4"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://stagpsppfizer.1mg.com/home"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://stagpsppfizer.1mg.com/api/data"))

        // Should NOT match different prefixes
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://other.gumlet.io/images/test.png"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://psppfizer.1mg.com/home"))
    }

    func testPrefixPatternIsCaseInsensitive() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/api/*"])

        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/api/users"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://EXAMPLE.COM/API/users"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://Example.Com/Api/Users"))
    }

    // ============================================================
    // Test 4: Pattern Matching - Suffix (*text)
    // ============================================================

    func testSuffixPatternMatchesURLsEndingWithPattern() {
        setConfigConstants(enabled: true, allowedUrls: ["*.js"])

        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://cdn.example.com/bundle.js"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/app.js"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://example.com/style.css"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://example.com/bundle.js.map"))
    }

    func testSuffixPatternWithDomain() {
        setConfigConstants(enabled: true, allowedUrls: ["*example.com"])

        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://www.example.com"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://api.example.com"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://example.com.evil.com"))
    }

    // ============================================================
    // Test 5: URL Cleaning - Query Parameters and Hash
    // ============================================================

    func testURLCleaningRemovesQueryParameters() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/page"])

        // All these should match because query params are stripped
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page?user=123"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page?user=123&session=abc"))
    }

    func testURLCleaningRemovesHashFragments() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/page"])

        // All these should match because hash is stripped
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page#section1"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page#top"))
    }

    func testURLCleaningRemovesBothQueryAndHash() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/page"])

        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page?user=123#section"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page#section?fake=param"))
    }

    // ============================================================
    // Test 6: URL Decoding - Bypass Prevention
    // ============================================================

    func testURLDecodingPreventsQueryParameterBypass() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/page"])

        // %3F is URL-encoded '?' - should be decoded and stripped
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page%3Fuser=123"))
    }

    func testURLDecodingPreventsHashBypass() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/page"])

        // %23 is URL-encoded '#' - should be decoded and stripped
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page%23section"))
    }

    func testURLDecodingHandlesMalformedURLsGracefully() {
        setConfigConstants(enabled: true, allowedUrls: ["example.com"])

        // Invalid percent encoding should not crash
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page%"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page%ZZ"))
    }

    // ============================================================
    // Test 7: Framework URLs (Always Allowed)
    // ============================================================

    func testFrameworkURLsAreAlwaysAllowedWhenAccessControlEnabled() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/*"])

        // Framework URLs should bypass access control
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("http://localhost/framework-files"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("http://localhost:8080/framework-upload"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("http://127.0.0.1/framework-download"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("http://127.0.0.1:3000/framework-handler"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://localhost/framework-secure"))
    }

    func testNonFrameworkLocalhostURLsFollowWhitelistRules() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/*"])

        // These don't match /framework- pattern, so should be blocked
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("http://localhost/api/data"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("http://localhost:8080/upload"))
    }

    // ============================================================
    // Test 8: Empty Patterns
    // ============================================================

    func testEmptyPatternListBlocksEverythingWhenAccessControlEnabled() {
        setConfigConstants(enabled: true, allowedUrls: [])

        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://example.com"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://google.com"))
    }

    func testPatternsWithOnlyWildcardsAreIgnored() {
        setConfigConstants(enabled: true, allowedUrls: ["*", "**", "***"])

        // All patterns are empty after wildcard removal, so block everything
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://example.com"))
    }

    // ============================================================
    // Test 9: Real-World Configuration (1mg Staging Environment)
    // ============================================================

    func testRealWorldConfiguration1mgStagingEnvironment() {
        // Your actual configuration
        setConfigConstants(enabled: true, allowedUrls: [
            "*.1mg.com*",
            "https://onemg.gumlet.io/*",
            "*browser.sentry-cdn.com/*",
            "https://psppfizer.1mg.com/*",
            "https://stagpsppfizer.1mg.com/*"
        ])

        // Primary URL that was failing before
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://stagpsppfizer.1mg.com:443/"))

        // Other valid URLs
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://stagpsppfizer.1mg.com:443/home?user=123"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://psppfizer.1mg.com/api/data"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://onemg.gumlet.io/images/test.png"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://browser.sentry-cdn.com/bundle.js"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://www.1mg.com/products"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://api.1mg.com/v1/users"))

        // Should be blocked
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://google.com"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://evil.com"))
    }

    func testRealWorldConfigurationWithQueryParamsStripped() {
        setConfigConstants(enabled: true, allowedUrls: ["*.1mg.com*"])

        // Query params with 1mg.com should NOT bypass (1mg.com not in clean URL)
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://evil.com/phishing?redirect=1mg.com"))

        // But legitimate 1mg.com URLs with query params should work
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://www.1mg.com/products?category=health"))
    }

    // ============================================================
    // Test 10: Port Handling
    // ============================================================

    func testExplicitPortsAreKeptInURLMatching() {
        setConfigConstants(enabled: true, allowedUrls: ["*.1mg.com*"])

        // Ports are kept as-is, pattern should still match
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://stagpsppfizer.1mg.com:443/"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://api.1mg.com:8080/data"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("http://www.1mg.com:80/page"))
    }

    func testPatternWithoutPortMatchesURLWithPort() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com/*"])

        // Pattern doesn't have port, URL does - should NOT match
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://example.com:8080/page"))

        // Exact match without port works
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page"))
    }

    func testPatternWithPortMatchesOnlySamePort() {
        setConfigConstants(enabled: true, allowedUrls: ["https://example.com:443/*"])

        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://example.com:443/page"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://example.com:8080/page"))
        XCTAssertFalse(URLWhitelistManager.shared.isUrlAllowed("https://example.com/page"))
    }

    // ============================================================
    // Test 11: Case Insensitivity
    // ============================================================

    func testPatternMatchingIsCaseInsensitive() {
        setConfigConstants(enabled: true, allowedUrls: ["*.ExAmPlE.cOm*"])

        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://www.example.com/page"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://WWW.EXAMPLE.COM/PAGE"))
        XCTAssertTrue(URLWhitelistManager.shared.isUrlAllowed("https://Www.Example.Com/Page"))
    }

    // ============================================================
    // Test 12: Thread Safety (Basic Check)
    // ============================================================

    func testConcurrentAccessDoesNotCrash() {
        setConfigConstants(enabled: true, allowedUrls: ["*.example.com*"])

        let expectation = XCTestExpectation(description: "Concurrent access")
        expectation.expectedFulfillmentCount = 10

        // Launch multiple threads accessing the manager
        for _ in 1...10 {
            DispatchQueue.global().async {
                for j in 0..<100 {
                    _ = URLWhitelistManager.shared.isUrlAllowed("https://www.example.com/page\(j)")
                    _ = URLWhitelistManager.shared.isAccessControlEnabled
                    _ = URLWhitelistManager.shared.isExternalDomain("https://google.com")
                }
                expectation.fulfill()
            }
        }

        wait(for: [expectation], timeout: 10.0)

        // If we get here without crashes, thread safety is working
        XCTAssertTrue(true)
    }
}
