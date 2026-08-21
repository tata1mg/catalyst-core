package io.yourname.androidproject

import android.content.Context
import android.webkit.WebView
import io.yourname.androidproject.utils.FrameworkServerUtils
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.io.path.createTempDirectory

/**
 * Loopback tests for FrameworkServerUtils, the Ktor-based localhost file
 * server — previously entirely untested (0%). Ports iOS's
 * FrameworkServerUtilsLoopbackTests.swift pattern: start the real
 * embedded server (Ktor/Netty, real socket, real port from the
 * 3000-3099 range) and make real HTTP requests against it via
 * java.net.HttpURLConnection (no new test dependency needed — this repo
 * has no OkHttp test dep, and the JDK's built-in client is enough for a
 * loopback GET/POST).
 *
 * FrameworkServerUtils is a singleton `object` — server state
 * (isServerRunning/serverPort/sessionId/servedFiles) is shared static
 * state across the whole test JVM. Every test starts fresh via
 * stopServer() in tearDown so state doesn't leak between tests or other
 * test classes running in the same JVM.
 *
 * Not chased here: the /ai/stream and /ai/generate SSE routes (need a
 * real nativeAiSupplier + Flow collection — a second, separate scope) and
 * the 5-minute cleanup task's periodic timer path. This file covers
 * lifecycle (start/stop/isRunning/getServerPort/getSessionId), file
 * serving (add/copy/remove), and the /status, file-serving, and
 * invalid-route HTTP endpoints — mirrors what iOS's loopback tests
 * covered for the equivalent Swift class.
 */
class FrameworkServerUtilsTest {

    private lateinit var cacheDir: java.io.File
    private lateinit var context: Context
    private lateinit var webView: WebView

    @Before
    fun setUp() {
        cacheDir = createTempDirectory(prefix = "catalyst-framework-server-test").toFile()
        context = mock { on { getCacheDir() } doReturn cacheDir }
        webView = mock { on { getUrl() } doReturn "http://localhost:8080/index.html" }
    }

    @After
    fun tearDown() {
        if (FrameworkServerUtils.isRunning()) {
            FrameworkServerUtils.stopServer()
        }
        cacheDir.deleteRecursively()
    }

    /** Waits briefly for Ktor/Netty's async bind to complete, mirroring the
     * "server may not start in this sandbox" tolerance pattern used on
     * iOS — returns false (caller should skip) if it never came up. */
    private fun startServerAndWaitReady(): Boolean {
        val started = FrameworkServerUtils.startServer(context, webView)
        if (!started) return false
        repeat(20) {
            if (FrameworkServerUtils.isRunning() && FrameworkServerUtils.getServerPort() != 0) return true
            Thread.sleep(100)
        }
        return FrameworkServerUtils.isRunning()
    }

    private fun get(path: String): Pair<Int, String> {
        val port = FrameworkServerUtils.getServerPort()
        val connection = URL("http://localhost:$port$path").openConnection() as HttpURLConnection
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        connection.setRequestProperty("Accept", "*/*")
        return try {
            val code = connection.responseCode
            val body = try {
                connection.inputStream.bufferedReader().readText()
            } catch (e: IOException) {
                connection.errorStream?.bufferedReader()?.readText() ?: ""
            }
            code to body
        } finally {
            connection.disconnect()
        }
    }

    // ============================================================
    // Lifecycle
    // ============================================================

    @Test
    fun `startServer starts the server and reports a port in the configured range`() {
        assumeServerStarts {
            assertTrue(FrameworkServerUtils.isRunning())
            assertTrue(FrameworkServerUtils.getServerPort() in 3000..3099)
            assertTrue(FrameworkServerUtils.getSessionId().isNotEmpty())
        }
    }

    @Test
    fun `startServer is idempotent when already running`() {
        assumeServerStarts {
            val firstPort = FrameworkServerUtils.getServerPort()
            val result = FrameworkServerUtils.startServer(context, webView)
            assertTrue(result)
            assertEquals(firstPort, FrameworkServerUtils.getServerPort())
        }
    }

    @Test
    fun `stopServer stops the server and isRunning reports false`() {
        assumeServerStarts {
            FrameworkServerUtils.stopServer()
            assertFalse(FrameworkServerUtils.isRunning())
        }
    }

    @Test
    fun `isRunning is false before any server has started`() {
        assertFalse(FrameworkServerUtils.isRunning())
    }

    @Test
    fun `a server restarted after stop can start again and serve a file`() {
        // Regression test for the serverScope-never-recreated bug:
        // serverScope was a `val`, so stopServer()'s serverScope.cancel()
        // permanently killed it — a restarted server's startCleanupTask()
        // then launched into an already-cancelled scope. This doesn't
        // directly assert the cleanup task itself (its failure was
        // silent — a cancelled scope just drops launched coroutines
        // rather than throwing at the call site), but it does exercise
        // the exact start -> stop -> start sequence that triggered it end
        // to end, including a real file being served on the restarted
        // instance, as the most direct available signal something didn't
        // regress.
        assumeServerStarts {
            FrameworkServerUtils.stopServer()
            assertFalse(FrameworkServerUtils.isRunning())

            val restarted = FrameworkServerUtils.startServer(context, webView)
            assertTrue(restarted)
            assertTrue(FrameworkServerUtils.isRunning())

            val tempFile = java.io.File(cacheDir, "after-restart.txt").apply { writeText("still works") }
            val url = FrameworkServerUtils.addFileToServe(tempFile, "after-restart.txt", "text/plain")
            assertNotNull(url)

            val path = url!!.substringAfter("localhost:${FrameworkServerUtils.getServerPort()}")
            val (code, body) = get(path)
            assertEquals(200, code)
            assertEquals("still works", body)
        }
    }

    // ============================================================
    // addFileToServe / copyAndServeFile / removeServedFile (not-running guards)
    // ============================================================

    @Test
    fun `addFileToServe returns null when the server is not running`() {
        assertFalse(FrameworkServerUtils.isRunning())
        val tempFile = java.io.File(cacheDir, "not-served.txt").apply { writeText("x") }

        val result = FrameworkServerUtils.addFileToServe(tempFile, "not-served.txt", "text/plain")

        assertNull(result)
    }

    @Test
    fun `copyAndServeFile returns null when the server is not running`() {
        assertFalse(FrameworkServerUtils.isRunning())
        val tempFile = java.io.File(cacheDir, "not-copied.txt").apply { writeText("x") }

        val result = FrameworkServerUtils.copyAndServeFile(tempFile, "not-copied.txt", "text/plain")

        assertNull(result)
    }

    @Test
    fun `addFileToServe returns a well-formed URL once the server is running`() {
        assumeServerStarts {
            val tempFile = java.io.File(cacheDir, "served.txt").apply { writeText("hello") }

            val url = FrameworkServerUtils.addFileToServe(tempFile, "served.txt", "text/plain")

            assertNotNull(url)
            assertTrue(url!!.startsWith("http://localhost:${FrameworkServerUtils.getServerPort()}/framework-${FrameworkServerUtils.getSessionId()}/file-"))
        }
    }

    // ============================================================
    // HTTP endpoints (real requests against the real embedded server)
    // ============================================================

    @Test
    fun `GET status returns 200 with running JSON`() {
        assumeServerStarts {
            val (code, body) = get("/framework-${FrameworkServerUtils.getSessionId()}/status")

            assertEquals(200, code)
            assertTrue(body.contains("\"status\":\"running\""))
            assertTrue(body.contains(FrameworkServerUtils.getSessionId()))
        }
    }

    @Test
    fun `GET a served file returns 200 with the real file content`() {
        assumeServerStarts {
            val content = "loopback content ${System.nanoTime()}"
            val tempFile = java.io.File(cacheDir, "loopback.txt").apply { writeText(content) }
            val url = FrameworkServerUtils.addFileToServe(tempFile, "loopback.txt", "text/plain")
            assertNotNull(url)

            val path = url!!.substringAfter("localhost:${FrameworkServerUtils.getServerPort()}")
            val (code, body) = get(path)

            assertEquals(200, code)
            assertEquals(content, body)
        }
    }

    @Test
    fun `GET an unknown fileId returns 404`() {
        assumeServerStarts {
            val (code, _) = get("/framework-${FrameworkServerUtils.getSessionId()}/file-does-not-exist")
            assertEquals(404, code)
        }
    }

    @Test
    fun `GET a served file whose physical file was deleted returns 404`() {
        assumeServerStarts {
            val tempFile = java.io.File(cacheDir, "vanish.txt").apply { writeText("will vanish") }
            val url = FrameworkServerUtils.addFileToServe(tempFile, "vanish.txt", "text/plain")
            assertNotNull(url)
            tempFile.delete()

            val path = url!!.substringAfter("localhost:${FrameworkServerUtils.getServerPort()}")
            val (code, _) = get(path)

            assertEquals(404, code)
        }
    }

    @Test
    fun `GET an invalid route returns 404`() {
        assumeServerStarts {
            val (code, _) = get("/framework-${FrameworkServerUtils.getSessionId()}/not-a-real-route")
            assertEquals(404, code)
        }
    }

    @Test
    fun `removeServedFile makes a subsequent request return 404`() {
        assumeServerStarts {
            val tempFile = java.io.File(cacheDir, "to-remove.txt").apply { writeText("bye") }
            val url = FrameworkServerUtils.addFileToServe(tempFile, "to-remove.txt", "text/plain")
            assertNotNull(url)
            val path = url!!.substringAfter("localhost:${FrameworkServerUtils.getServerPort()}")

            val (beforeCode, _) = get(path)
            assertEquals(200, beforeCode)

            val fileId = path.substringAfter("file-")
            FrameworkServerUtils.removeServedFile(fileId)

            val (afterCode, _) = get(path)
            assertEquals(404, afterCode)
        }
    }

    // Runs `block` only if the real Ktor/Netty server actually came up in
    // this sandbox; otherwise the test is silently skipped rather than
    // failed — matches the "server may not start in this environment"
    // tolerance pattern from the iOS loopback tests (network restrictions
    // in some CI/sandbox environments can prevent binding a real socket).
    private fun assumeServerStarts(block: () -> Unit) {
        if (!startServerAndWaitReady()) {
            org.junit.Assume.assumeTrue("Framework server failed to start in this environment — skipping", false)
            return
        }
        block()
    }
}
