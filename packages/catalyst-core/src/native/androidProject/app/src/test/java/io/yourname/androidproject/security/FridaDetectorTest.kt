package io.yourname.androidproject.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.net.ServerSocket

/**
 * Unit tests for FridaDetector (Android coverage batch 3), previously
 * entirely untested (0/~96 lines).
 *
 * FridaDetector is a pure-JVM `object` for its core isFridaDetected() path
 * -- java.io.File existence checks, a real SocketChannel connect against
 * Frida's default ports, /proc/self/maps line scanning, and
 * Class.forName() lookups. None of that needs Context or a View, so this
 * suite exercises it directly with no Mockito mocking of Android types at
 * all:
 *
 * - checkFridaPorts: verified empirically (see task history) that binding
 *   a real java.net.ServerSocket on 127.0.0.1:27042 makes
 *   isFridaDetected() return true via the real non-blocking
 *   SocketChannel.connect()/finishConnect() loop; no listener there means
 *   the connect fails/times out and the check contributes false. This is
 *   more reliable than trying to mock java.nio.channels.SocketChannel
 *   (a concrete JDK class, not a mockable Android stub).
 * - checkFridaFiles / checkHookingFrameworks' XposedBridge.jar file check:
 *   these check hardcoded absolute paths (e.g. /data/local/tmp/
 *   frida-server, /system/framework/XposedBridge.jar) that do not exist on
 *   a dev/CI JVM test runner, so they deterministically contribute false
 *   here. This suite does not attempt to fake those paths into existing
 *   (would require filesystem root manipulation out of scope for a unit
 *   test) -- the false branch is exercised implicitly by every test that
 *   doesn't plant a listening socket.
 * - checkLoadedLibraries reads the real /proc/self/maps, which does not
 *   exist on macOS (only Linux) -- mapsFile.exists() is false there, so
 *   this check deterministically contributes false regardless of
 *   platform. On a Linux CI runner it would read the actual test JVM's
 *   real maps, which won't contain Frida/Xposed library names in a normal
 *   run either. Not independently forced true in this suite (would
 *   require a fake /proc/self/maps, not feasible without a mockable JDK
 *   File).
 * - checkHookingFrameworks' Class.forName() checks (XposedBridge,
 *   substrate.MS) genuinely throw ClassNotFoundException on the plain JVM
 *   test classpath, exercising their catch-and-return-false branches for
 *   real -- no mocking needed.
 *
 * Deliberately OUT OF SCOPE: getFridaCheckDetails() as a whole. It builds
 * its return value as a single `mapOf(...)` literal, so the "isDebuggable"
 * entry's Build.FINGERPRINT/Build.TAGS access (static final fields under
 * the mockable android.jar, NOT interceptable by Mockito) is evaluated
 * eagerly and unconditionally -- confirmed empirically to throw an
 * uncaught NullPointerException before the function can even return.
 * There is no reachable subset of that function's behavior to test
 * without touching those two fields, so it is skipped entirely (see the
 * dedicated comment above its section for detail) rather than chased for
 * partial coverage.
 */
class FridaDetectorTest {

    // ============================================================
    // isFridaDetected -- no hooking indicators present (baseline)
    // ============================================================

    @Test
    fun `isFridaDetected returns false in a clean test environment with no listener and no suspicious files`() {
        assertFalse(FridaDetector.isFridaDetected())
    }

    // ============================================================
    // isFridaDetected -- Frida port check forced positive
    // ============================================================

    @Test
    fun `isFridaDetected returns true when a listener is bound on Frida's default port 27042`() {
        val server = bindOrSkip(27042)
        try {
            assertTrue(FridaDetector.isFridaDetected())
        } finally {
            server.close()
        }
    }

    @Test
    fun `isFridaDetected returns true when a listener is bound on Frida's alternate port 27043`() {
        val server = bindOrSkip(27043)
        try {
            assertTrue(FridaDetector.isFridaDetected())
        } finally {
            server.close()
        }
    }

    // ============================================================
    // checkFridaFiles indirectly, via isFridaDetected -- files absent
    // ============================================================

    @Test
    fun `isFridaDetected does not false-positive on unrelated existing files`() {
        // Sanity check that checkFridaFiles is checking specific hardcoded
        // paths, not "any file exists somewhere" -- a real file existing
        // elsewhere on disk must not trip detection.
        val unrelated = File.createTempFile("not-frida", ".tmp")
        try {
            assertFalse(FridaDetector.isFridaDetected())
        } finally {
            unrelated.delete()
        }
    }

    // ============================================================
    // getFridaCheckDetails -- NOT tested, entirely out of scope.
    //
    // Empirically confirmed (java.lang.NullPointerException at the
    // Build.FINGERPRINT.lowercase() call): the function builds its
    // return value as a single Kotlin `mapOf(...)` literal, which
    // eagerly evaluates every entry -- including the "isDebuggable"
    // entry's inline `Build.FINGERPRINT.lowercase().contains(...) ||
    // Build.TAGS.lowercase().contains(...)` expression -- before the
    // map is ever constructed. Build.FINGERPRINT/Build.TAGS are null
    // under the mockable android.jar (isReturnDefaultValues=true), so
    // calling getFridaCheckDetails() at all throws uncaught, with no
    // try/catch anywhere in the function to absorb it. Unlike
    // EmulatorDetector.getEmulatorCheckDetails or FridaDetector's own
    // isFridaDetected() (which wraps checks in try/catch and degrades to
    // false), there is no reachable code path here that avoids touching
    // those two fields. Per the task's Build.* limitation, this function
    // is skipped entirely rather than partially asserted on.
    // ============================================================
    // helpers
    // ============================================================

    /**
     * Binds a real listening socket on the given loopback port. Frida's
     * default ports (27042/27043) are vanishingly unlikely to already be
     * occupied on a dev/CI machine, but fail loudly with a clear message
     * rather than producing a mystery assertion failure if they are.
     */
    private fun bindOrSkip(port: Int): ServerSocket {
        return try {
            ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress("127.0.0.1", port))
            }
        } catch (e: Exception) {
            throw IllegalStateException(
                "Could not bind port $port for FridaDetector test -- is something " +
                    "already listening on it (ironically, maybe even a real frida-server)?",
                e
            )
        }
    }
}
