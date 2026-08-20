package io.yourname.androidproject

import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.MockedStatic
import org.mockito.Mockito.mockStatic
import org.mockito.kotlin.any
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import java.io.File
import kotlin.io.path.createTempDirectory

/**
 * #413: first Mockito-based test in this template, covering
 * OfflineCacheService — previously untested because it takes a real
 * android.content.Context in its constructor and calls the unmocked
 * android.net.Uri / android.webkit.CookieManager Android-stub classes
 * internally (JVM unit tests run against the SDK's stub jar, which throws
 * on any call unless testOptions.unitTests.isReturnDefaultValues is set,
 * or the class is mocked — see app/build.gradle.kts).
 *
 * Uri.parse(...) is mocked statically per test via Mockito's inline
 * mock-maker (the mockito-core 5.x default) so isHttpUrl/isOfflineRouteUrl/
 * shouldCacheAssetUrl exercise real logic against fake-but-realistic parsed
 * URIs, rather than the SDK stub's default null/false behavior.
 */
class OfflineCacheServiceTest {

    private lateinit var cacheDir: File
    private lateinit var context: Context
    private lateinit var uriMock: MockedStatic<Uri>
    private lateinit var cookieManagerMock: MockedStatic<CookieManager>

    @Before
    fun setUp() {
        cacheDir = createTempDirectory(prefix = "catalyst-offline-test").toFile()
        context = mock {
            on { getCacheDir() } doReturn cacheDir
        }

        uriMock = mockStatic(Uri::class.java)
        uriMock.`when`<Uri> { Uri.parse(any()) }.thenAnswer { invocation ->
            fakeUriFor(invocation.getArgument(0))
        }

        // CookieManager.getInstance() has no real webview in a JVM unit
        // test; stub it to a mock that reports no cookies, matching what
        // production sees on a fresh device before any cookies are set.
        val cookieManager = mock<CookieManager> {
            on { getCookie(any()) } doReturn null
        }
        cookieManagerMock = mockStatic(CookieManager::class.java)
        cookieManagerMock.`when`<CookieManager> { CookieManager.getInstance() }.thenReturn(cookieManager)
    }

    @After
    fun tearDown() {
        uriMock.close()
        cookieManagerMock.close()
        cacheDir.deleteRecursively()
    }

    // A tiny fake of what Uri.parse() would return for the http(s) URLs
    // this class actually deals with — just enough of the real contract
    // (scheme/authority/path/fragment stripping) for the code under test.
    private fun fakeUriFor(url: String): Uri {
        val schemeEnd = url.indexOf("://")
        val scheme = if (schemeEnd >= 0) url.substring(0, schemeEnd) else null
        val afterScheme = if (schemeEnd >= 0) url.substring(schemeEnd + 3) else url
        val pathStart = afterScheme.indexOf('/').let { if (it < 0) afterScheme.length else it }
        val authority = if (schemeEnd >= 0) afterScheme.substring(0, pathStart) else null
        val rawPath = afterScheme.substring(pathStart).substringBefore('#').ifEmpty { "/" }
        val withoutFragment = url.substringBefore('#')

        val withoutFragmentUri = mock<Uri>()
        whenever(withoutFragmentUri.toString()) doReturn withoutFragment

        val builder = mock<Uri.Builder>()
        whenever(builder.fragment(org.mockito.kotlin.anyOrNull())) doReturn builder
        whenever(builder.build()) doReturn withoutFragmentUri

        val uri = mock<Uri>()
        whenever(uri.scheme) doReturn scheme
        whenever(uri.authority) doReturn authority
        whenever(uri.path) doReturn rawPath
        whenever(uri.toString()) doReturn withoutFragment
        whenever(uri.buildUpon()) doReturn builder
        return uri
    }

    @Test
    fun `shouldCacheAssetUrl accepts known static-asset extensions over http(s)`() {
        val service = OfflineCacheService(context)

        assertTrue(service.shouldCacheAssetUrl("https://example.com/static/app.js"))
        assertTrue(service.shouldCacheAssetUrl("https://example.com/static/app.CSS"))
        assertFalse(service.shouldCacheAssetUrl("https://example.com/api/data"))
    }

    @Test
    fun `shouldCacheAssetUrl rejects non-http(s) schemes`() {
        val service = OfflineCacheService(context)

        assertFalse(service.shouldCacheAssetUrl("file:///static/app.js"))
    }

    @Test
    fun `hasRouteSnapshot is false when no manifest has been loaded`() {
        val service = OfflineCacheService(context)

        assertFalse(service.hasRouteSnapshot("https://example.com/some/route"))
    }

    @Test
    fun `getRouteSnapshotResponse returns null when route is not offline-eligible`() {
        val service = OfflineCacheService(context)

        assertNull(service.getRouteSnapshotResponse("https://example.com/not-cached"))
    }

    @Test
    fun `clearAll resets cached manifest state without throwing`() {
        val service = OfflineCacheService(context)

        service.clearAll()

        assertFalse(service.hasRouteSnapshot("https://example.com/some/route"))
        assertTrue(cacheDir.exists())
    }

    @Test
    fun `context getCacheDir is consulted exactly once at construction`() {
        OfflineCacheService(context)

        org.mockito.kotlin.verify(context).getCacheDir()
    }
}
