package io.yourname.androidproject

import android.net.Uri
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.MockedStatic
import org.mockito.Mockito.mockStatic
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever

/**
 * Unit tests for the top-level matchesCachePattern function in Utils.kt
 * (Android coverage batch 4), previously entirely untested (0/18 lines,
 * reported under the synthetic class name UtilsKt in jacoco).
 *
 * matchesCachePattern calls android.net.Uri.parse(url) internally, which
 * returns null under the mockable android.jar (isReturnDefaultValues=true)
 * unless statically mocked -- following the exact Uri.parse mockStatic
 * pattern established in OfflineCacheServiceTest. Unlike that fake, this
 * one only needs Uri.path stubbed (matchesCachePattern reads nothing else
 * off the parsed Uri), and it deliberately strips both '?' and '#' when
 * deriving the path -- matching what the real Uri.parse/getPath contract
 * does (query and fragment are never part of getPath()), which is required
 * for the KDoc's own "?v=123" and "#section" examples to actually match.
 *
 * Covered: the empty-cachePatterns short-circuit, the null-path guard (via
 * a designated fake Uri with a null path), wildcard (*) pattern matching
 * including hashed/versioned filenames and query/fragment stripping,
 * case-insensitivity, exact (non-wildcard) pattern matching, and the
 * empty-filename guard (trailing-slash URL). Not covered: the outer
 * try/catch's Exception branch -- Uri.parse is mocked to never throw here,
 * and the real Android Uri.parse implementation practically never throws
 * (it does lenient parsing), so there is no reachable production input that
 * exercises that branch; this mirrors DownloadUtilsTest's documented stance
 * on similar defensively-written but practically unreachable catch blocks.
 */
class UtilsKtTest {

    private lateinit var uriMock: MockedStatic<Uri>

    @Before
    fun setUp() {
        uriMock = mockStatic(Uri::class.java)
        uriMock.`when`<Uri> { Uri.parse(any()) }.thenAnswer { invocation ->
            fakeUriFor(invocation.getArgument(0))
        }
    }

    @After
    fun tearDown() {
        uriMock.close()
    }

    // Minimal fake of what Uri.parse(url).path would return: everything
    // after the authority, with query params and fragment stripped, same
    // as the real android.net.Uri contract. A url containing the sentinel
    // "NULLPATH" simulates a Uri whose path is null (e.g. an opaque URI),
    // to exercise matchesCachePattern's `?: return false` guard.
    private fun fakeUriFor(url: String): Uri {
        val uri = mock<Uri>()
        if (url.contains("NULLPATH")) {
            whenever(uri.path).thenReturn(null)
            return uri
        }
        val schemeEnd = url.indexOf("://")
        val afterScheme = if (schemeEnd >= 0) url.substring(schemeEnd + 3) else url
        val pathStart = afterScheme.indexOf('/').let { if (it < 0) afterScheme.length else it }
        val rawPath = afterScheme.substring(pathStart)
            .substringBefore('?')
            .substringBefore('#')
        whenever(uri.path).thenReturn(rawPath.ifEmpty { "/" })
        return uri
    }

    @Test
    fun `returns false immediately when cachePatterns is empty`() {
        assertFalse(matchesCachePattern("https://example.com/app.css", emptyList()))
    }

    @Test
    fun `returns false when the parsed uri has a null path`() {
        assertFalse(matchesCachePattern("opaque:NULLPATH", listOf("*.css")))
    }

    @Test
    fun `wildcard pattern matches a plain filename`() {
        assertTrue(matchesCachePattern("http://example.com/app.css", listOf("*.css")))
    }

    @Test
    fun `wildcard pattern matches a hashed versioned filename`() {
        assertTrue(matchesCachePattern("http://example.com/app.d4e5dea6.css", listOf("*.css")))
    }

    @Test
    fun `wildcard pattern matches with query parameters stripped`() {
        assertTrue(matchesCachePattern("http://example.com/app.css?v=123", listOf("*.css")))
    }

    @Test
    fun `wildcard pattern matches with a fragment stripped`() {
        assertTrue(matchesCachePattern("http://example.com/path/to/style.css#section", listOf("*.css")))
    }

    @Test
    fun `wildcard pattern matches js bundle variants`() {
        assertTrue(matchesCachePattern("http://example.com/bundle.js", listOf("*.js")))
        assertTrue(matchesCachePattern("http://example.com/bundle.abc123.js", listOf("*.js")))
        assertTrue(matchesCachePattern("http://example.com/bundle.js?t=456", listOf("*.js")))
    }

    @Test
    fun `wildcard pattern matching is case-insensitive`() {
        assertTrue(matchesCachePattern("http://example.com/APP.CSS", listOf("*.css")))
        assertTrue(matchesCachePattern("http://example.com/app.css", listOf("*.CSS")))
    }

    @Test
    fun `wildcard pattern does not match an unrelated extension`() {
        assertFalse(matchesCachePattern("http://example.com/app.png", listOf("*.css")))
    }

    @Test
    fun `exact pattern matches full filename case-insensitively`() {
        assertTrue(matchesCachePattern("http://example.com/manifest.json", listOf("manifest.json")))
        assertTrue(matchesCachePattern("http://example.com/MANIFEST.JSON", listOf("manifest.json")))
    }

    @Test
    fun `exact pattern does not match a different filename`() {
        assertFalse(matchesCachePattern("http://example.com/other.json", listOf("manifest.json")))
    }

    @Test
    fun `returns false when the path has an empty filename (trailing slash)`() {
        assertFalse(matchesCachePattern("http://example.com/", listOf("*.css")))
    }

    @Test
    fun `matches if any pattern in the list matches`() {
        assertTrue(matchesCachePattern("http://example.com/app.css", listOf("*.js", "*.css", "*.png")))
    }

    @Test
    fun `returns false when no pattern in the list matches`() {
        assertFalse(matchesCachePattern("http://example.com/app.css", listOf("*.js", "*.png")))
    }
}
