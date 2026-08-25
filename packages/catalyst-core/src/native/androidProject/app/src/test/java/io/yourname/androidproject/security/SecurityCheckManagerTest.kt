package io.yourname.androidproject.security

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import java.io.ByteArrayInputStream
import java.net.InetSocketAddress
import java.net.ServerSocket

/**
 * Unit tests for SecurityCheckManager (Android coverage batch 3),
 * previously entirely untested (0/~67 lines).
 *
 * SecurityCheckManager is an `object` that only needs a Context (for
 * `RootBeer(context)` and `context.getSharedPreferences(...)`) -- no
 * Views. It orchestrates EmulatorDetector / FridaDetector / RootBeer via
 * coroutines (Dispatchers.Default, real -- not Dispatchers.Main, so
 * kotlinx-coroutines-test's virtual-time scheduler does not intercept it;
 * runTest{} is used only to satisfy the `suspend` signature, matching this
 * project's established pattern for suspend functions under test, e.g.
 * WebCacheManagerTest).
 *
 * Key empirically-verified facts this suite relies on (see task history):
 * - `RootBeer(context).isRooted` throws an uncaught NullPointerException
 *   against a plain Mockito Context mock (PackageManager is null under
 *   the mockable jar) -- but checkRooted() wraps the call in try/catch,
 *   so in every test here isRooted resolves to false. This suite does NOT
 *   attempt to force isRooted=true: RootBeer is constructed directly
 *   inside checkRooted() (not injected), and RootBeer is a real
 *   non-Android library class with no Context-driven seam to intercept
 *   its result -- forcing a rooted result would require Mockito's
 *   inline mockConstruction, which is unverified to fire reliably across
 *   the coroutine worker thread checkRooted() actually runs on
 *   (Dispatchers.Default), so it is deliberately not attempted.
 * - EmulatorDetector.isEmulator(mockContext) returns false cleanly (its
 *   own outer try/catch absorbs the Build.FINGERPRINT-driven NPE path;
 *   see FridaDetectorTest and EmulatorDetector's own known Build.* limits)
 *   -- so isEmulator is always false in this suite. Forcing it true would
 *   require mocking Build.* static final fields, which Mockito cannot do
 *   (see project-wide rule).
 * - FridaDetector.isFridaDetected() CAN be deterministically forced true
 *   by binding a real listening socket on Frida's default port 127.0.0.1:
 *   27042 (see FridaDetectorTest) -- this is therefore the only one of
 *   the three local checks this suite drives to the BLOCK-triggering
 *   branch, and it is enough to exercise isCompromised=true /
 *   recommendation="BLOCK" end-to-end through performSecurityChecks
 *   without touching Build.* or RootBeer at all.
 *
 * Covered: performSecurityChecks' ALLOW path (nothing detected) and BLOCK
 * path (via the Frida-socket trick), its JSONObject field shape,
 * saveLatestResults/getLatestSecurityResults round-trip through a mocked
 * SharedPreferences, calculateRecommendation's branches (exercised
 * indirectly through performSecurityChecks, since it's private), and
 * getSecurityMode's present/default/malformed-config branches via a mocked
 * AssetManager.
 *
 * Deliberately OUT OF SCOPE: createErrorResponse() is only reachable when
 * the try block in performSecurityChecks throws -- every checked call
 * inside it (checkRooted/checkEmulator/checkFridaDetected) has its own
 * internal try/catch that swallows exceptions and returns false, and
 * saveLatestResults also catches internally, so there is no reachable
 * failure path to trigger it from the public API surface without
 * reflection or bytecode manipulation. Not attempted. All of the
 * commented-out Play Integrity code (getGoogleToken,
 * performPlayIntegrityCheck, cachePlayIntegrityResult, etc.) is inactive
 * source (commented out) and not compiled, so there is nothing to test.
 */
class SecurityCheckManagerTest {

    private lateinit var prefsStorage: MutableMap<String, String?>
    private lateinit var sharedPreferences: SharedPreferences
    private lateinit var editor: SharedPreferences.Editor
    private lateinit var context: Context

    @Before
    fun setUp() {
        prefsStorage = mutableMapOf()

        editor = mock {
            on { putString(any(), any()) } doAnswer { invocation ->
                val key = invocation.getArgument<String>(0)
                val value = invocation.getArgument<String?>(1)
                prefsStorage[key] = value
                editor
            }
        }
        // apply() is Unit-returning; default mock behavior (no-op) is fine,
        // but we still want the stored value visible without invoking a
        // real Android disk write.
        org.mockito.kotlin.doNothing().`when`(editor).apply()

        sharedPreferences = mock {
            on { getString(any(), org.mockito.kotlin.anyOrNull()) } doAnswer { invocation ->
                val key = invocation.getArgument<String>(0)
                val default = invocation.getArgument<String?>(1)
                prefsStorage[key] ?: default
            }
            on { edit() } doReturn editor
        }

        context = mock {
            on { getSharedPreferences(any(), any()) } doReturn sharedPreferences
        }
    }

    @After
    fun tearDown() {
        prefsStorage.clear()
    }

    // ============================================================
    // performSecurityChecks -- ALLOW path (clean environment)
    // ============================================================

    @Test
    fun `performSecurityChecks returns ALLOW and not compromised when no local threat is detected`() = runTest {
        val results = SecurityCheckManager.performSecurityChecks(context)

        assertFalse(results.getBoolean("isRooted"))
        assertFalse(results.getBoolean("isEmulator"))
        assertFalse(results.getBoolean("isFridaDetected"))
        assertFalse(results.getBoolean("isCompromised"))
        assertEquals("ALLOW", results.getString("recommendation"))
        assertFalse(results.getBoolean("pending"))
        assertTrue(results.has("timestamp"))
    }

    @Test
    fun `performSecurityChecks does not include a playIntegrity entry while Play Integrity is disabled`() {
        runTest {
            val results = SecurityCheckManager.performSecurityChecks(context)
            assertFalse(results.has("playIntegrity"))
        }
    }

    @Test
    fun `performSecurityChecks persists the latest results to SharedPreferences`() = runTest {
        SecurityCheckManager.performSecurityChecks(context)

        val saved = prefsStorage["latest_security_results"]
        assertTrue(saved != null)
        val savedJson = JSONObject(saved!!)
        assertEquals("ALLOW", savedJson.getString("recommendation"))
    }

    // ============================================================
    // performSecurityChecks -- BLOCK path (Frida socket trick)
    // ============================================================

    @Test
    fun `performSecurityChecks returns BLOCK and compromised when Frida is detected`() = runTest {
        val server = bindOrSkip(27042)
        try {
            val results = SecurityCheckManager.performSecurityChecks(context)

            assertTrue(results.getBoolean("isFridaDetected"))
            assertTrue(results.getBoolean("isCompromised"))
            assertEquals("BLOCK", results.getString("recommendation"))
        } finally {
            server.close()
        }
    }

    // ============================================================
    // getLatestSecurityResults
    // ============================================================

    @Test
    fun `getLatestSecurityResults returns null when nothing has been saved yet`() {
        assertNull(SecurityCheckManager.getLatestSecurityResults(context))
    }

    @Test
    fun `getLatestSecurityResults returns the previously saved results`() = runTest {
        SecurityCheckManager.performSecurityChecks(context)

        val latest = SecurityCheckManager.getLatestSecurityResults(context)
        assertTrue(latest != null)
        assertEquals("ALLOW", latest!!.getString("recommendation"))
    }

    @Test
    fun `getLatestSecurityResults returns null when SharedPreferences access throws`() {
        val throwingContext: Context = mock {
            on { getSharedPreferences(any(), any()) } doAnswer { throw RuntimeException("boom") }
        }

        assertNull(SecurityCheckManager.getLatestSecurityResults(throwingContext))
    }

    // ============================================================
    // getSecurityMode
    // ============================================================

    @Test
    fun `getSecurityMode returns the configured value when present`() {
        val propsContext = contextWithProperties("android.security.mode=strict\n")

        assertEquals("strict", SecurityCheckManager.getSecurityMode(propsContext))
    }

    @Test
    fun `getSecurityMode defaults to 'default' when the key is absent`() {
        val propsContext = contextWithProperties("some.other.key=value\n")

        assertEquals("default", SecurityCheckManager.getSecurityMode(propsContext))
    }

    @Test
    fun `getSecurityMode defaults to 'default' when reading the properties file throws`() {
        val throwingAssets: android.content.res.AssetManager = mock {
            on { open(any()) } doAnswer { throw java.io.IOException("no such asset") }
        }
        val propsContext: Context = mock {
            on { getAssets() } doReturn throwingAssets
        }

        assertEquals("default", SecurityCheckManager.getSecurityMode(propsContext))
    }

    // ============================================================
    // helpers
    // ============================================================

    private fun contextWithProperties(propertiesContent: String): Context {
        val assets: android.content.res.AssetManager = mock {
            on { open("webview_config.properties") } doReturn ByteArrayInputStream(propertiesContent.toByteArray())
        }
        return mock {
            on { getAssets() } doReturn assets
        }
    }

    private fun bindOrSkip(port: Int): ServerSocket {
        return try {
            ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress("127.0.0.1", port))
            }
        } catch (e: Exception) {
            throw IllegalStateException(
                "Could not bind port $port for SecurityCheckManager test -- is something " +
                    "already listening on it?",
                e
            )
        }
    }
}
