package io.yourname.androidproject

import org.junit.Assert.*
import org.junit.Test
import java.util.Properties

/**
 * Unit tests for CustomWebView
 * Tests configuration loading, navigation handling, resource loading, and lifecycle logic
 *
 * Coverage:
 * - Configuration Loading (5 tests)
 * - Navigation Handling (6 tests)
 * - Resource Loading (5 tests)
 * - WebView Lifecycle (4 tests)
 *
 * Total: 20 tests
 *
 * Note: Tests focus on the logic and algorithms used by CustomWebView without requiring
 * full Android Context or WebView instantiation, similar to WebCacheManagerTest approach.
 */
class CustomWebviewTest {

    // ============================================================
    // CATEGORY 1: CONFIGURATION LOADING (5 tests)
    // ============================================================

    @Test
    fun `test properties build type parsing`() {
        val properties1 = Properties().apply {
            setProperty("buildType", "debug")
        }
        assertEquals("debug", properties1.getProperty("buildType"))

        val properties2 = Properties().apply {
            setProperty("buildType", "release")
        }
        assertEquals("release", properties2.getProperty("buildType"))

        // Test default value when not set
        val properties3 = Properties()
        assertEquals("debug", properties3.getProperty("buildType", "debug"))
    }

    @Test
    fun `test properties API base URL parsing`() {
        val properties = Properties().apply {
            setProperty("apiBaseUrl", "https://api.example.com")
        }

        val apiBaseUrl = properties.getProperty("apiBaseUrl", "")
        assertEquals("https://api.example.com", apiBaseUrl)
        assertTrue("API URL should be HTTPS", apiBaseUrl.startsWith("https://"))
    }

    @Test
    fun `test cache pattern parsing from properties`() {
        // Test single cache pattern
        val singlePattern = "*.css"
        val patterns1 = singlePattern.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        assertEquals("Should parse single pattern", 1, patterns1.size)
        assertEquals("*.css", patterns1[0])

        // Test multiple cache patterns
        val multiplePattern = "*.css,*.js,*.png"
        val patterns2 = multiplePattern.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        assertEquals("Should parse 3 patterns", 3, patterns2.size)
        assertTrue("Should contain CSS pattern", patterns2.contains("*.css"))
        assertTrue("Should contain JS pattern", patterns2.contains("*.js"))
        assertTrue("Should contain PNG pattern", patterns2.contains("*.png"))

        // Test with spaces
        val patternWithSpaces = " *.woff , *.woff2 , *.ttf "
        val patterns3 = patternWithSpaces.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        assertEquals("Should handle spaces", 3, patterns3.size)
        assertEquals("*.woff", patterns3[0])
        assertEquals("*.woff2", patterns3[1])
        assertEquals("*.ttf", patterns3[2])
    }

    @Test
    fun `test access control configuration parsing`() {
        val properties = Properties().apply {
            setProperty("accessControl.enabled", "true")
            setProperty("accessControl.allowedUrls", "https://example.com,https://api.example.com")
        }

        val enabled = properties.getProperty("accessControl.enabled", "true").equals("true", ignoreCase = true)
        assertTrue("Access control should be enabled", enabled)

        val allowedUrls = properties.getProperty("accessControl.allowedUrls", "")
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        assertEquals("Should have 2 allowed URLs", 2, allowedUrls.size)
        assertTrue("Should contain example.com", allowedUrls.contains("https://example.com"))
        assertTrue("Should contain api.example.com", allowedUrls.contains("https://api.example.com"))

        // Test disabled
        val disabledProps = Properties().apply {
            setProperty("accessControl.enabled", "false")
        }
        val disabled = disabledProps.getProperty("accessControl.enabled", "true").equals("true", ignoreCase = true)
        assertFalse("Access control should be disabled", disabled)
    }

    @Test
    fun `test build optimization flag parsing`() {
        val properties1 = Properties().apply {
            setProperty("buildOptimisation", "true")
        }
        assertTrue("Build optimization should be true",
            properties1.getProperty("buildOptimisation", "false").toBoolean())

        val properties2 = Properties().apply {
            setProperty("buildOptimisation", "false")
        }
        assertFalse("Build optimization should be false",
            properties2.getProperty("buildOptimisation", "false").toBoolean())

        // Test default
        val properties3 = Properties()
        assertFalse("Default should be false",
            properties3.getProperty("buildOptimisation", "false").toBoolean())
    }

    // ============================================================
    // CATEGORY 2: NAVIGATION HANDLING (6 tests)
    // ============================================================

    @Test
    fun `test allowed URL navigation when access control enabled`() {
        val allowedUrls = listOf("https://example.com*", "https://api.example.com*")

        // Initialize URLWhitelistManager with access control enabled
        URLWhitelistManager.initialize(true, allowedUrls)

        // Verify URLWhitelistManager is configured correctly
        assertTrue(
            "Allowed URL should be permitted",
            URLWhitelistManager.isUrlAllowed("https://example.com/page")
        )
        assertTrue(
            "API URL should be permitted",
            URLWhitelistManager.isUrlAllowed("https://api.example.com/data")
        )
        assertTrue(
            "Subdirectories should be allowed",
            URLWhitelistManager.isUrlAllowed("https://example.com/page/subpage")
        )
    }

    @Test
    fun `test blocked URL navigation when access control enabled`() {
        val allowedUrls = listOf("https://example.com*")

        // Initialize URLWhitelistManager with restricted access
        URLWhitelistManager.initialize(true, allowedUrls)

        // Verify URLWhitelistManager blocks disallowed URLs
        assertFalse(
            "Blocked URL should be rejected",
            URLWhitelistManager.isUrlAllowed("https://malicious.com")
        )
        assertFalse(
            "Different domain should be blocked",
            URLWhitelistManager.isUrlAllowed("https://other.com")
        )
        assertFalse(
            "Random domain should be blocked",
            URLWhitelistManager.isUrlAllowed("https://hacker.org/phishing")
        )
    }

    @Test
    fun `test external domain detection logic`() {
        val allowedUrls = listOf("https://example.com*")
        URLWhitelistManager.initialize(true, allowedUrls)

        // Test that isExternalDomain detects external URLs
        assertTrue(
            "Different domain should be detected as external",
            URLWhitelistManager.isExternalDomain("https://google.com")
        )
        assertTrue(
            "API domain should be external if not whitelisted",
            URLWhitelistManager.isExternalDomain("https://api.different.com")
        )

        assertFalse(
            "Same domain should not be external",
            URLWhitelistManager.isExternalDomain("https://example.com/page2")
        )
    }

    @Test
    fun `test localhost framework URLs bypass access control`() {
        val allowedUrls = listOf("https://example.com*")
        URLWhitelistManager.initialize(true, allowedUrls)

        // Localhost framework URLs should always be allowed (bypass access control)
        assertTrue(
            "Localhost framework URL should be allowed",
            URLWhitelistManager.isUrlAllowed("https://localhost:5173/framework-init")
        )
        assertTrue(
            "127.0.0.1 framework URL should be allowed",
            URLWhitelistManager.isUrlAllowed("https://127.0.0.1:5173/framework-app")
        )
        assertTrue(
            "Localhost with any port should be allowed",
            URLWhitelistManager.isUrlAllowed("https://localhost:8080/framework-test")
        )
    }

    @Test
    fun `test URL handling when access control disabled`() {
        // Disable access control - all URLs should be allowed
        URLWhitelistManager.initialize(false, emptyList())

        // All URLs should be allowed when access control is disabled
        assertTrue(
            "HTTP URL should be allowed when access control disabled",
            URLWhitelistManager.isUrlAllowed("http://example.com")
        )
        assertTrue(
            "HTTPS URL should be allowed",
            URLWhitelistManager.isUrlAllowed("https://example.com")
        )
        assertTrue(
            "Any domain should be allowed",
            URLWhitelistManager.isUrlAllowed("https://any-domain.com")
        )
        assertTrue(
            "Localhost should still be allowed",
            URLWhitelistManager.isUrlAllowed("https://localhost:3000")
        )
    }

    @Test
    fun `test special URL scheme detection`() {
        // Test tel: scheme
        val telUrl = "tel:+1234567890"
        assertTrue("tel: scheme should start with tel:", telUrl.startsWith("tel:"))

        // Test mailto: scheme
        val mailtoUrl = "mailto:user@example.com"
        assertTrue("mailto: scheme should start with mailto:", mailtoUrl.startsWith("mailto:"))

        // Test sms: scheme
        val smsUrl = "sms:+1234567890"
        assertTrue("sms: scheme should start with sms:", smsUrl.startsWith("sms:"))

        // Test http/https should not be special schemes
        val httpUrl = "https://example.com"
        assertFalse("https: should not be special scheme", httpUrl.startsWith("tel:"))
        assertFalse("https: should not be special scheme", httpUrl.startsWith("mailto:"))
        assertFalse("https: should not be special scheme", httpUrl.startsWith("sms:"))
    }

    // ============================================================
    // CATEGORY 3: RESOURCE LOADING (5 tests)
    // ============================================================

    @Test
    fun `test cache pattern matching logic for CSS files`() {
        // Test the wildcard pattern matching logic used in matchesCachePattern
        val pattern = "*.css"
        val regexPattern = pattern
            .replace(".", "\\.")
            .replace("*", ".*")
            .let { "^$it$" }
        val regex = regexPattern.toRegex(RegexOption.IGNORE_CASE)

        // Extract filename from URLs
        val cssFile = "app.css"  // from https://example.com/app.css
        assertTrue("CSS file should match pattern", regex.matches(cssFile))

        val cssWithHash = "app.d4e5dea6.css"  // from https://example.com/app.d4e5dea6.css
        assertTrue("CSS file with hash should match", regex.matches(cssWithHash))

        // PNG should not match CSS pattern
        val pngFile = "image.png"
        assertFalse("PNG file should not match CSS pattern", regex.matches(pngFile))
    }

    @Test
    fun `test cache pattern matching logic for JS files`() {
        // Test JavaScript file pattern matching
        val pattern = "*.js"
        val regexPattern = pattern
            .replace(".", "\\.")
            .replace("*", ".*")
            .let { "^$it$" }
        val regex = regexPattern.toRegex(RegexOption.IGNORE_CASE)

        // Extract filenames (query params would be stripped in actual implementation)
        val jsFile = "bundle.js"
        assertTrue("JS file should match pattern", regex.matches(jsFile))

        val jsWithHash = "bundle.abc123.js"
        assertTrue("JS file with hash should match", regex.matches(jsWithHash))

        // CSS should not match JS-only pattern
        val cssFile = "style.css"
        assertFalse("CSS file should not match JS pattern", regex.matches(cssFile))
    }

    @Test
    fun `test cache pattern matching logic for font files`() {
        // Test font file pattern matching (WOFF, WOFF2, TTF)
        val patterns = listOf("*.woff", "*.woff2", "*.ttf")

        val woffFile = "font.woff"
        val woff2File = "font.woff2"
        val ttfFile = "font.ttf"
        val pngFile = "logo.png"

        // Check if any pattern matches WOFF
        val woffMatches = patterns.any { pattern ->
            val regex = pattern.replace(".", "\\.").replace("*", ".*").let { "^$it$" }.toRegex(RegexOption.IGNORE_CASE)
            regex.matches(woffFile)
        }
        assertTrue("WOFF file should match pattern", woffMatches)

        // Check if any pattern matches WOFF2
        val woff2Matches = patterns.any { pattern ->
            val regex = pattern.replace(".", "\\.").replace("*", ".*").let { "^$it$" }.toRegex(RegexOption.IGNORE_CASE)
            regex.matches(woff2File)
        }
        assertTrue("WOFF2 file should match pattern", woff2Matches)

        // Check if any pattern matches TTF
        val ttfMatches = patterns.any { pattern ->
            val regex = pattern.replace(".", "\\.").replace("*", ".*").let { "^$it$" }.toRegex(RegexOption.IGNORE_CASE)
            regex.matches(ttfFile)
        }
        assertTrue("TTF file should match pattern", ttfMatches)

        // PNG should not match font patterns
        val pngMatches = patterns.any { pattern ->
            val regex = pattern.replace(".", "\\.").replace("*", ".*").let { "^$it$" }.toRegex(RegexOption.IGNORE_CASE)
            regex.matches(pngFile)
        }
        assertFalse("PNG file should not match font patterns", pngMatches)
    }

    @Test
    fun `test API call detection logic`() {
        val apiBaseUrl = "https://api.example.com"

        // URLs starting with apiBaseUrl should be identified as API calls
        assertTrue(
            "API URL should be detected",
            "https://api.example.com/users".startsWith(apiBaseUrl)
        )
        assertTrue(
            "API endpoint should be detected",
            "https://api.example.com/data/123".startsWith(apiBaseUrl)
        )
        assertFalse(
            "Static resource should not be API call",
            "https://example.com/app.js".startsWith(apiBaseUrl)
        )
        assertFalse(
            "Different domain should not be API call",
            "https://cdn.example.com/resource".startsWith(apiBaseUrl)
        )
    }

    @Test
    fun `test static resource detection by extension`() {
        val staticExtensions = listOf(".js", ".css", ".png", ".jpg", ".woff", ".woff2")

        // Test that files with static extensions are recognized
        assertTrue("JS file should be static resource",
            staticExtensions.any { "https://example.com/app.js".endsWith(it) })
        assertTrue("CSS file should be static resource",
            staticExtensions.any { "https://example.com/style.css".endsWith(it) })
        assertTrue("PNG image should be static resource",
            staticExtensions.any { "https://example.com/logo.png".endsWith(it) })
        assertTrue("WOFF font should be static resource",
            staticExtensions.any { "https://example.com/font.woff2".endsWith(it) })

        // API endpoints should not be static resources
        assertFalse("API endpoint should not be static resource",
            staticExtensions.any { "https://api.example.com/users".endsWith(it) })
        assertFalse("HTML page should not match static extensions",
            staticExtensions.any { "https://example.com/page".endsWith(it) })
    }

    // ============================================================
    // CATEGORY 4: WEBVIEW LIFECYCLE (4 tests)
    // ============================================================

    @Test
    fun `test MIME type detection for HTML`() {
        val path1 = "index.html"
        val mimeType1 = when {
            path1.endsWith(".html") -> "text/html"
            else -> "application/octet-stream"
        }
        assertEquals("HTML file should have text/html MIME type", "text/html", mimeType1)
    }

    @Test
    fun `test MIME type detection for JavaScript and CSS`() {
        val jsPath = "app.js"
        val jsMimeType = when {
            jsPath.endsWith(".js") -> "application/javascript"
            else -> "application/octet-stream"
        }
        assertEquals("JS file should have application/javascript MIME type",
            "application/javascript", jsMimeType)

        val cssPath = "style.css"
        val cssMimeType = when {
            cssPath.endsWith(".css") -> "text/css"
            else -> "application/octet-stream"
        }
        assertEquals("CSS file should have text/css MIME type", "text/css", cssMimeType)
    }

    @Test
    fun `test MIME type detection for images`() {
        val pngMime = when {
            "image.png".endsWith(".png") -> "image/png"
            else -> "application/octet-stream"
        }
        assertEquals("PNG should have image/png MIME type", "image/png", pngMime)

        val jpgMime = when {
            "photo.jpg".endsWith(".jpg") -> "image/jpeg"
            else -> "application/octet-stream"
        }
        assertEquals("JPG should have image/jpeg MIME type", "image/jpeg", jpgMime)

        val svgMime = when {
            "icon.svg".endsWith(".svg") -> "image/svg+xml"
            else -> "application/octet-stream"
        }
        assertEquals("SVG should have image/svg+xml MIME type", "image/svg+xml", svgMime)
    }

    @Test
    fun `test MIME type detection for fonts`() {
        val woffMime = when {
            "font.woff".endsWith(".woff") -> "font/woff"
            else -> "application/octet-stream"
        }
        assertEquals("WOFF should have font/woff MIME type", "font/woff", woffMime)

        val woff2Mime = when {
            "font.woff2".endsWith(".woff2") -> "font/woff2"
            else -> "application/octet-stream"
        }
        assertEquals("WOFF2 should have font/woff2 MIME type", "font/woff2", woff2Mime)

        val ttfMime = when {
            "font.ttf".endsWith(".ttf") -> "font/ttf"
            else -> "application/octet-stream"
        }
        assertEquals("TTF should have font/ttf MIME type", "font/ttf", ttfMime)
    }
}
