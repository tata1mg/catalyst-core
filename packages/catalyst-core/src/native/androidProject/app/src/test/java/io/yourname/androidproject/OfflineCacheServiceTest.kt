package io.yourname.androidproject

import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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

    // ============================================================
    // Manifest-driven routing (batch 4 extension)
    //
    // The manifest is loaded once at construction time via
    // loadCachedManifest() -> parseManifest(), reading a plain
    // manifest.json file under context.cacheDir/catalyst_offline/ — no
    // network involved. Pre-writing that file before constructing
    // OfflineCacheService unlocks isOfflineRouteUrl/getRouteSnapshotResponse/
    // hasRouteSnapshot's real-match branches, previously only exercised
    // via their "no manifest loaded" empty-state paths above.
    // ============================================================

    private fun writeManifest(buildId: String, routes: List<Pair<String, String>>) {
        val rootDir = File(cacheDir, "catalyst_offline")
        rootDir.mkdirs()
        val routesJson = routes.joinToString(",") { (pattern, regex) ->
            """{"pattern":"$pattern","regex":"$regex"}"""
        }
        val json = """{"buildId":"$buildId","routes":[$routesJson]}"""
        File(rootDir, "manifest.json").writeText(json)
    }

    @Test
    fun `isOfflineRouteUrl matches a route whose regex matches the url path`() {
        writeManifest("build-123", listOf("/docs/*" to "^/docs/.*$"))
        val service = OfflineCacheService(context)

        assertTrue(service.isOfflineRouteUrl("https://example.com/docs/getting-started"))
    }

    @Test
    fun `isOfflineRouteUrl returns false when no route regex matches`() {
        writeManifest("build-123", listOf("/docs/*" to "^/docs/.*$"))
        val service = OfflineCacheService(context)

        assertFalse(service.isOfflineRouteUrl("https://example.com/api/data"))
    }

    @Test
    fun `isOfflineRouteUrl returns false for a non-http(s) url even with a loaded manifest`() {
        writeManifest("build-123", listOf("/docs/*" to "^/docs/.*$"))
        val service = OfflineCacheService(context)

        assertFalse(service.isOfflineRouteUrl("file:///docs/local.html"))
    }

    @Test
    fun `isOfflineRouteUrl treats an unparseable route regex as a non-match, not a crash`() {
        // "[" is an invalid regex -- Regex(...).matches() should throw,
        // caught internally and treated as "this route doesn't match"
        // rather than propagating.
        writeManifest("build-123", listOf("/broken" to "["))
        val service = OfflineCacheService(context)

        assertFalse(service.isOfflineRouteUrl("https://example.com/broken"))
    }

    @Test
    fun `hasRouteSnapshot is true only when the route is eligible AND a snapshot file exists on disk`() {
        writeManifest("build-123", listOf("/docs/*" to "^/docs/.*$"))
        val service = OfflineCacheService(context)
        val url = "https://example.com/docs/getting-started"

        // Route is eligible per the manifest, but no snapshot has been
        // written to disk yet.
        assertFalse(service.hasRouteSnapshot(url))
    }

    private fun sha256Hex(value: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    @Test
    fun `getRouteSnapshotResponse serves a real snapshot file for an eligible, snapshotted route`() {
        writeManifest("build-123", listOf("/docs/*" to "^/docs/.*$"))
        val url = "https://example.com/docs/getting-started"

        // snapshotFileForUrl/hash are private; reproduce their (simple,
        // stable) SHA-256-based path layout here to place a snapshot file
        // exactly where the production code will look for it:
        //   routes/<hash(origin:buildId)>/<hash(normalizedUrl)>.html
        val namespace = "https://example.com:build-123"
        val namespaceDir = File(cacheDir, "catalyst_offline/routes/${sha256Hex(namespace)}")
        namespaceDir.mkdirs()
        File(namespaceDir, "${sha256Hex(url)}.html").writeText("<html>cached docs page</html>")

        val service = OfflineCacheService(context)

        // WebResourceResponse is an android.webkit SDK stub class: its
        // constructor is a no-op under the mockable jar and its getters
        // return defaults regardless of what was passed in (confirmed
        // empirically earlier this session, see WebCacheManagerTest) --
        // only "a response object was returned" is assertable here, not
        // its field contents.
        assertTrue(service.hasRouteSnapshot(url))
        assertNotNull(service.getRouteSnapshotResponse(url))
    }

    @Test
    fun `getRouteSnapshotResponse returns null when the route is eligible but no snapshot file exists yet`() {
        writeManifest("build-123", listOf("/docs/*" to "^/docs/.*$"))
        val service = OfflineCacheService(context)
        val url = "https://example.com/docs/getting-started"

        assertFalse(service.hasRouteSnapshot(url))
        assertNull(service.getRouteSnapshotResponse(url))
    }

    @Test
    fun `clearAll removes a manifest loaded from a previous instance`() {
        writeManifest("build-123", listOf("/docs/*" to "^/docs/.*$"))
        val service = OfflineCacheService(context)
        assertTrue(service.isOfflineRouteUrl("https://example.com/docs/x"))

        service.clearAll()

        // manifest is nulled out by clearAll(); route matching should
        // fall back to "no manifest" behavior immediately, in the same
        // instance, without needing to reconstruct the service.
        assertFalse(service.isOfflineRouteUrl("https://example.com/docs/x"))
    }

    @Test
    fun `a second OfflineCacheService instance loads the manifest persisted by a previous one`() {
        writeManifest("build-456", listOf("/blog/*" to "^/blog/.*$"))

        // First instance's constructor already ran loadCachedManifest();
        // this constructs a second instance against the SAME cacheDir to
        // confirm the on-disk manifest.json (not just in-memory state) is
        // what's actually being read.
        OfflineCacheService(context)
        val secondInstance = OfflineCacheService(context)

        assertTrue(secondInstance.isOfflineRouteUrl("https://example.com/blog/post-1"))
    }

    @Test
    fun `a malformed manifest json on disk is treated as no manifest, not a crash`() {
        val rootDir = File(cacheDir, "catalyst_offline")
        rootDir.mkdirs()
        File(rootDir, "manifest.json").writeText("not valid json {{{")

        val service = OfflineCacheService(context)

        assertFalse(service.isOfflineRouteUrl("https://example.com/docs/x"))
    }

    @Test
    fun `a manifest with an empty routes array loads without matching anything`() {
        writeManifest("build-789", emptyList())
        val service = OfflineCacheService(context)

        assertFalse(service.isOfflineRouteUrl("https://example.com/anything"))
    }
}
