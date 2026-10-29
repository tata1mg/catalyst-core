import XCTest
@testable import CatalystCoreLogic

final class PluginBridgeOriginPolicyTests: XCTestCase {
    private let app = URL(string: "https://app.example.com/home?x=1")

    private func allowed(_ source: String?, main: Bool = true, trusted: URL? = nil) -> Bool {
        PluginBridgeOriginPolicy.isAllowed(
            isMainFrame: main,
            sourceURL: source.flatMap(URL.init(string:)),
            trustedURL: trusted ?? app
        )
    }

    func testSameOriginDifferentPathIsAllowed() {
        XCTAssertTrue(allowed("https://app.example.com/other/page"))
    }

    func testHostCaseAndExplicitDefaultPortCompareEqual() {
        XCTAssertTrue(allowed("https://APP.example.com:443/"))
        XCTAssertTrue(allowed("http://localhost:80/", trusted: URL(string: "http://localhost")))
    }

    func testDevServerOriginWithPort() {
        let dev = URL(string: "http://192.168.0.6:3005/")
        XCTAssertTrue(allowed("http://192.168.0.6:3005/some/route", trusted: dev))
        XCTAssertFalse(allowed("http://192.168.0.6:3006/", trusted: dev))
    }

    func testDifferentHostSchemeOrPortIsRejected() {
        XCTAssertFalse(allowed("https://evil.example.com/"))
        XCTAssertFalse(allowed("http://app.example.com/"))
        XCTAssertFalse(allowed("https://app.example.com:8443/"))
    }

    func testLookalikeHostsAreRejected() {
        XCTAssertFalse(allowed("https://app.example.com.evil.com/"))
        XCTAssertFalse(allowed("https://evilapp.example.com/"))
        XCTAssertFalse(allowed("https://sub.app.example.com/"))
    }

    func testSubframeIsRejectedEvenWhenSameOrigin() {
        XCTAssertFalse(allowed("https://app.example.com/", main: false))
    }

    func testFailsClosedWithoutOrigins() {
        XCTAssertFalse(allowed(nil))
        XCTAssertFalse(allowed("https://app.example.com/", trusted: URL(string: "not a url")))
        XCTAssertFalse(PluginBridgeOriginPolicy.isAllowed(isMainFrame: true, sourceURL: nil, trustedURL: nil))
    }

    func testNonHTTPSchemesAreNeverAllowed() {
        XCTAssertFalse(allowed("file:///etc/hosts"))
        XCTAssertFalse(allowed("about:blank"))
        XCTAssertFalse(allowed("javascript:alert(1)"))
        XCTAssertFalse(allowed("https://app.example.com/", trusted: URL(string: "file:///app/index.html")))
    }
}
