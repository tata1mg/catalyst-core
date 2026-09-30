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
        // Unlike the positive tests below (which need a specific port
        // bound and should fail loudly if that's not possible), this
        // negative assertion's only real dependency is that NOTHING is
        // listening on Frida's ports right now -- if something is (even,
        // ironically, a real frida-server on the host), that's an
        // environment fact this test can't control, so skip rather than
        // fail. checkPortFree(...) reports that state without binding
        // anything itself, avoiding a bind-vs-connect race with the
        // detector's own check.
        org.junit.Assume.assumeTrue(
            "Something is already listening on port 27042 or 27043 in this environment — skipping",
            checkPortFree(27042) && checkPortFree(27043)
        )
        assertFalse(FridaDetector.isFridaDetected())
    }

    // ============================================================
    // isFridaDetected -- Frida port check forced positive
    // ============================================================

    @Test
    fun `isFridaDetected returns true when a listener is bound on Frida's default port 27042`() {
        val server = bindOrFailLoudly(27042)
        try {
            assertTrue(FridaDetector.isFridaDetected())
        } finally {
            server.close()
        }
    }

    @Test
    fun `isFridaDetected returns true when a listener is bound on Frida's alternate port 27043`() {
        val server = bindOrFailLoudly(27043)
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
     *
     * Named to reflect what it actually does (previously `bindOrSkip`,
     * which never skipped anything -- CodeRabbit flagged the mismatch).
     * These positive-detection tests intentionally do NOT tolerate a
     * bind failure the way the negative test above does: if the port is
     * already occupied, that's worth knowing loudly rather than quietly
     * skipping a test meant to prove isFridaDetected() actually detects
     * something.
     */
    private fun bindOrFailLoudly(port: Int): ServerSocket {
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

    /**
     * Reports whether a loopback port currently has nothing listening on
     * it, without holding a bind itself (so it can't race the detector's
     * own connect attempt in isFridaDetected()). Used only to decide
     * whether the clean-environment negative test should run at all.
     */
    private fun checkPortFree(port: Int): Boolean {
        return try {
            ServerSocket().use {
                it.reuseAddress = true
                it.bind(InetSocketAddress("127.0.0.1", port))
            }
            true
        } catch (e: Exception) {
            false
        }
    }
}
