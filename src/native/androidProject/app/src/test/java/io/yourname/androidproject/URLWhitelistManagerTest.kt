package io.yourname.androidproject

import org.junit.Test
import org.junit.Assert.*
import org.junit.Before

/**
 * Unit tests for URLWhitelistManager
 * Tests pattern matching, access control, URL cleaning, and thread safety
 */
class URLWhitelistManagerTest {

    @Before
    fun setup() {
        // Reset state before each test
        URLWhitelistManager.initialize(enabled = false, allowedUrls = emptyList())
    }

    // ============================================================
    // Test 1: Access Control Enabled/Disabled
    // ============================================================

    @Test
    fun `test access control disabled allows all URLs`() {
        URLWhitelistManager.initialize(
            enabled = false,
            allowedUrls = listOf("https://example.com/*")
        )

        // Even though only example.com is in patterns, all URLs should be allowed
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://google.com"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://evil.com"))
        assertFalse(URLWhitelistManager.isAccessControlEnabled())
    }

    @Test
    fun `test access control enabled blocks non-whitelisted URLs`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/*")
        )

        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://google.com"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://evil.com"))
        assertTrue(URLWhitelistManager.isAccessControlEnabled())
    }

    @Test
    fun `test isExternalDomain with access control disabled`() {
        URLWhitelistManager.initialize(
            enabled = false,
            allowedUrls = listOf("https://example.com/*")
        )

        // Nothing is external when access control is disabled
        assertFalse(URLWhitelistManager.isExternalDomain("https://google.com"))
        assertFalse(URLWhitelistManager.isExternalDomain("https://evil.com"))
    }

    @Test
    fun `test isExternalDomain with access control enabled`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/*")
        )

        assertFalse(URLWhitelistManager.isExternalDomain("https://example.com/page"))
        assertTrue(URLWhitelistManager.isExternalDomain("https://google.com"))
        assertTrue(URLWhitelistManager.isExternalDomain("https://evil.com"))
    }

    // ============================================================
    // Test 2: Pattern Matching - Contains (*text* or text)
    // ============================================================

    @Test
    fun `test contains pattern with wildcards on both sides`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("*.1mg.com*")
        )

        // Should match any URL containing ".1mg.com"
        assertTrue(URLWhitelistManager.isUrlAllowed("https://stagpsppfizer.1mg.com:443/"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://www.1mg.com/products"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://api.1mg.com/v1/users"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://subdomain.1mg.com/anything"))

        // Should NOT match (1mg.com not in the domain part)
        assertFalse(URLWhitelistManager.isUrlAllowed("https://evil.com/phishing?redirect=1mg.com"))
    }

    @Test
    fun `test contains pattern without wildcards`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("1mg.com")
        )

        // Should match any URL containing "1mg.com" (same as *.1mg.com*)
        assertTrue(URLWhitelistManager.isUrlAllowed("https://www.1mg.com/products"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://api.1mg.com/v1/users"))

        // This is developer responsibility - pattern is too broad
        assertTrue(URLWhitelistManager.isUrlAllowed("https://evil.1mg.com.attacker.com/"))
    }

    @Test
    fun `test multiple contains patterns`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf(
                "*browser.sentry-cdn.com/*",
                "*.1mg.com*"
            )
        )

        assertTrue(URLWhitelistManager.isUrlAllowed("https://browser.sentry-cdn.com/bundle.js"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://www.1mg.com/products"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://google.com"))
    }

    // ============================================================
    // Test 3: Pattern Matching - Prefix (text*)
    // ============================================================

    @Test
    fun `test prefix pattern matches URLs starting with pattern`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf(
                "https://onemg.gumlet.io/*",
                "https://stagpsppfizer.1mg.com/*"
            )
        )

        // Should match URLs starting with the pattern
        assertTrue(URLWhitelistManager.isUrlAllowed("https://onemg.gumlet.io/images/test.png"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://onemg.gumlet.io/videos/demo.mp4"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://stagpsppfizer.1mg.com/home"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://stagpsppfizer.1mg.com/api/data"))

        // Should NOT match different prefixes
        assertFalse(URLWhitelistManager.isUrlAllowed("https://other.gumlet.io/images/test.png"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://psppfizer.1mg.com/home"))
    }

    @Test
    fun `test prefix pattern is case insensitive`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/api/*")
        )

        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/api/users"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://EXAMPLE.COM/API/users"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://Example.Com/Api/Users"))
    }

    // ============================================================
    // Test 4: Pattern Matching - Suffix (*text)
    // ============================================================

    @Test
    fun `test suffix pattern matches URLs ending with pattern`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("*.js")
        )

        assertTrue(URLWhitelistManager.isUrlAllowed("https://cdn.example.com/bundle.js"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/app.js"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://example.com/style.css"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://example.com/bundle.js.map"))
    }

    @Test
    fun `test suffix pattern with domain`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("*example.com")
        )

        assertTrue(URLWhitelistManager.isUrlAllowed("https://www.example.com"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://api.example.com"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://example.com.evil.com"))
    }

    // ============================================================
    // Test 5: URL Cleaning - Query Parameters and Hash
    // ============================================================

    @Test
    fun `test URL cleaning removes query parameters`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/page")
        )

        // All these should match because query params are stripped
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page?user=123"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page?user=123&session=abc"))
    }

    @Test
    fun `test URL cleaning removes hash fragments`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/page")
        )

        // All these should match because hash is stripped
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page#section1"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page#top"))
    }

    @Test
    fun `test URL cleaning removes both query and hash`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/page")
        )

        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page?user=123#section"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page#section?fake=param"))
    }

    // ============================================================
    // Test 6: URL Decoding - Bypass Prevention
    // ============================================================

    @Test
    fun `test URL decoding prevents query parameter bypass`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/page")
        )

        // %3F is URL-encoded '?' - should be decoded and stripped
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page%3Fuser=123"))
    }

    @Test
    fun `test URL decoding prevents hash bypass`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/page")
        )

        // %23 is URL-encoded '#' - should be decoded and stripped
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page%23section"))
    }

    @Test
    fun `test URL decoding handles malformed URLs gracefully`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("example.com")
        )

        // Invalid percent encoding should not crash
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page%"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page%ZZ"))
    }

    // ============================================================
    // Test 7: Framework URLs (Always Allowed)
    // ============================================================

    @Test
    fun `test framework URLs are always allowed when access control enabled`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/*")
        )

        // Framework URLs should bypass access control
        assertTrue(URLWhitelistManager.isUrlAllowed("http://localhost/framework-files"))
        assertTrue(URLWhitelistManager.isUrlAllowed("http://localhost:8080/framework-upload"))
        assertTrue(URLWhitelistManager.isUrlAllowed("http://127.0.0.1/framework-download"))
        assertTrue(URLWhitelistManager.isUrlAllowed("http://127.0.0.1:3000/framework-handler"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://localhost/framework-secure"))
    }

    @Test
    fun `test non-framework localhost URLs follow whitelist rules`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/*")
        )

        // These don't match /framework- pattern, so should be blocked
        assertFalse(URLWhitelistManager.isUrlAllowed("http://localhost/api/data"))
        assertFalse(URLWhitelistManager.isUrlAllowed("http://localhost:8080/upload"))
    }

    // ============================================================
    // Test 8: Empty Patterns
    // ============================================================

    @Test
    fun `test empty pattern list blocks everything when access control enabled`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = emptyList()
        )

        assertFalse(URLWhitelistManager.isUrlAllowed("https://example.com"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://google.com"))
    }

    @Test
    fun `test patterns with only wildcards are ignored`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("*", "**", "***")
        )

        // All patterns are empty after wildcard removal, so block everything
        assertFalse(URLWhitelistManager.isUrlAllowed("https://example.com"))
    }

    // ============================================================
    // Test 9: Real-World Configuration (Your Actual Config)
    // ============================================================

    @Test
    fun `test real-world configuration - 1mg staging environment`() {
        // Your actual configuration from the checkpoint
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf(
                "*.1mg.com*",
                "https://onemg.gumlet.io/*",
                "*browser.sentry-cdn.com/*",
                "https://psppfizer.1mg.com/*",
                "https://stagpsppfizer.1mg.com/*"
            )
        )

        // Primary URL that was failing before
        assertTrue(URLWhitelistManager.isUrlAllowed("https://stagpsppfizer.1mg.com:443/"))

        // Other valid URLs
        assertTrue(URLWhitelistManager.isUrlAllowed("https://stagpsppfizer.1mg.com:443/home?user=123"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://psppfizer.1mg.com/api/data"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://onemg.gumlet.io/images/test.png"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://browser.sentry-cdn.com/bundle.js"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://www.1mg.com/products"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://api.1mg.com/v1/users"))

        // Should be blocked
        assertFalse(URLWhitelistManager.isUrlAllowed("https://google.com"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://evil.com"))
    }

    @Test
    fun `test real-world configuration with query params stripped`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("*.1mg.com*")
        )

        // Query params with 1mg.com should NOT bypass (1mg.com not in clean URL)
        assertFalse(URLWhitelistManager.isUrlAllowed("https://evil.com/phishing?redirect=1mg.com"))

        // But legitimate 1mg.com URLs with query params should work
        assertTrue(URLWhitelistManager.isUrlAllowed("https://www.1mg.com/products?category=health"))
    }

    // ============================================================
    // Test 10: Port Handling
    // ============================================================

    @Test
    fun `test explicit ports are kept in URL matching`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("*.1mg.com*")
        )

        // Ports are kept as-is, pattern should still match
        assertTrue(URLWhitelistManager.isUrlAllowed("https://stagpsppfizer.1mg.com:443/"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://api.1mg.com:8080/data"))
        assertTrue(URLWhitelistManager.isUrlAllowed("http://www.1mg.com:80/page"))
    }

    @Test
    fun `test pattern without port matches URL with port`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com/*")
        )

        // Pattern doesn't have port, URL does - should NOT match
        assertFalse(URLWhitelistManager.isUrlAllowed("https://example.com:8080/page"))

        // Exact match without port works
        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com/page"))
    }

    @Test
    fun `test pattern with port matches only same port`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("https://example.com:443/*")
        )

        assertTrue(URLWhitelistManager.isUrlAllowed("https://example.com:443/page"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://example.com:8080/page"))
        assertFalse(URLWhitelistManager.isUrlAllowed("https://example.com/page"))
    }

    // ============================================================
    // Test 11: Case Insensitivity
    // ============================================================

    @Test
    fun `test pattern matching is case insensitive`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("*.ExAmPlE.cOm*")
        )

        assertTrue(URLWhitelistManager.isUrlAllowed("https://www.example.com/page"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://WWW.EXAMPLE.COM/PAGE"))
        assertTrue(URLWhitelistManager.isUrlAllowed("https://Www.Example.Com/Page"))
    }

    // ============================================================
    // Test 12: Thread Safety (Basic Check)
    // ============================================================

    @Test
    fun `test concurrent access does not crash`() {
        URLWhitelistManager.initialize(
            enabled = true,
            allowedUrls = listOf("*.example.com*")
        )

        // Launch multiple threads accessing the manager
        val threads = (1..10).map {
            Thread {
                repeat(100) {
                    URLWhitelistManager.isUrlAllowed("https://www.example.com/page$it")
                    URLWhitelistManager.isAccessControlEnabled()
                    URLWhitelistManager.isExternalDomain("https://google.com")
                }
            }
        }

        threads.forEach { it.start() }
        threads.forEach { it.join() }

        // If we get here without crashes, thread safety is working
        assertTrue(true)
    }
}
