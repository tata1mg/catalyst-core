package io.yourname.androidproject.plugins

import android.app.Activity
import android.webkit.WebView
import io.yourname.androidproject.CatalystConstants
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.mockito.ArgumentCaptor
import org.mockito.kotlin.any
import org.mockito.kotlin.anyOrNull
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import java.util.Properties

/**
 * Instance-method coverage added in coverage batch 3 (companion/parseRequest
 * coverage predates this batch and is untouched above).
 *
 * GeneratedPluginIndex (pluginIdToClassName / pluginToCommands) is checked
 * into this worktree as two permanently-empty maps -- there is no codegen
 * step in this checkout that populates it (grep across the project turns up
 * nothing but the declaration and PluginBridge's two reads of it). PluginBridge
 * snapshots both maps into private vals at construction time (`private val
 * pluginIdToClassName = GeneratedPluginIndex.pluginIdToClassName`), so
 * redirecting them for a test would require either:
 *   (a) reflectively overwriting GeneratedPluginIndex's static final fields --
 *       tried first; JDK 17+'s hardened final-field reflection (in effect
 *       here even though the Kotlin/Java source/target is 11, because it's
 *       enforced by the JDK actually running the JVM tests -- confirmed
 *       empirically: java -version reports 23.0.1) throws
 *       IllegalAccessException on Field.set(...) regardless of
 *       setAccessible(true); or
 *   (b) Mockito.mockStatic(GeneratedPluginIndex::class.java) -- also tried;
 *       Kotlin objects expose `val`s to same-module callers as direct
 *       GETSTATIC field reads, not a getter method call, so there is no
 *       method for Mockito's static stubbing to intercept (compiles only if
 *       you invent a fake `getXxx()` method that doesn't exist).
 * Both were verified empirically with throwaway probe tests before writing
 * this file, per this project's "don't guess, verify" rule.
 *
 * Consequently hasPlugin()/hasCommand() can only be exercised on their
 * "not found" branches, and getPluginForId()/the real plugin.handle(...)
 * dispatch call in emit() (PLUGIN_NOT_REGISTERED's throw path, the
 * Class.forName success path, PLUGIN_INSTANTIATION_FAILED, and
 * PLUGIN_EXECUTION_FAILED from a throwing plugin) are unreachable from this
 * test file without modifying GeneratedPluginIndex.kt or PluginBridge.kt
 * itself, which is out of scope per this task's file-touch restriction.
 * This is flagged as a production testability smell in the task report,
 * not silently worked around.
 *
 * What IS covered here: every branch of emit() that's reachable with an
 * empty plugin index (blank/invalid payload, missing pluginId, missing
 * command, unsupported plugin), sendBridgeError's JSON shape and its
 * requestId/command propagation, hasPlugin's false branch, and
 * PluginBridgeContext.callback/toJavaScriptLiteral's branches directly
 * (that class is public and constructible without going through
 * PluginBridge.emit() at all).
 */
class PluginBridgeTest {

    private lateinit var activity: Activity
    private lateinit var webView: WebView
    private lateinit var properties: Properties

    @Before
    fun setUp() {
        activity = mock()
        // Run the posted Runnable synchronously so evaluateJavascript is
        // actually invoked within the test body -- matching the
        // recommended pattern for WebView.post in this project's
        // WebView-adjacent tests.
        webView = mock {
            on { post(any()) } doAnswer { invocation ->
                invocation.getArgument<Runnable>(0).run()
                true
            }
        }
        properties = Properties()
    }

    private fun captureEvaluatedJs(): String {
        val jsCaptor = ArgumentCaptor.forClass(String::class.java)
        verify(webView).evaluateJavascript(jsCaptor.capture(), anyOrNull())
        return jsCaptor.value
    }

    @Test
    fun `parseRequest accepts valid payload and trims string fields`() {
        val request = PluginBridge.parseRequest(
            """
                {
                    "pluginId": "  device-info-plugin  ",
                    "command": "  getDeviceInfo  ",
                    "data": { "includeSecurity": true },
                    "requestId": "  req-123  "
                }
            """.trimIndent()
        )

        assertEquals("device-info-plugin", request.pluginId)
        assertEquals("getDeviceInfo", request.command)
        assertEquals("req-123", request.requestId)
        assertEquals(true, (request.data as JSONObject).getBoolean("includeSecurity"))
    }

    @Test
    fun `parseRequest treats blank requestId as null`() {
        val request = PluginBridge.parseRequest(
            """
                {
                    "pluginId": "device-info-plugin",
                    "command": "getDeviceInfo",
                    "requestId": "   "
                }
            """.trimIndent()
        )

        assertNull(request.requestId)
    }

    @Test
    fun `parseRequest rejects blank payload`() {
        try {
            PluginBridge.parseRequest("   ")
            fail("Expected invalid blank payload to throw")
        } catch (error: IllegalArgumentException) {
            assertEquals("Payload is required", error.message)
        }
    }

    @Test
    fun `parseRequest rejects oversized payload`() {
        val oversizedData = "x".repeat(CatalystConstants.Bridge.MAX_MESSAGE_SIZE + 256)
        val payload = """
            {
                "pluginId": "device-info-plugin",
                "command": "getDeviceInfo",
                "data": "$oversizedData"
            }
        """.trimIndent()

        try {
            PluginBridge.parseRequest(payload)
            fail("Expected oversized payload to throw")
        } catch (error: IllegalArgumentException) {
            assertEquals("Payload exceeds maximum size", error.message)
        }
    }

    @Test
    fun `parseRequest rejects non string pluginId`() {
        try {
            PluginBridge.parseRequest(
                """
                    {
                        "pluginId": 42,
                        "command": "getDeviceInfo"
                    }
                """.trimIndent()
            )
            fail("Expected non-string pluginId to throw")
        } catch (error: IllegalArgumentException) {
            assertEquals("pluginId must be a string", error.message)
        }
    }

    @Test
    fun `parseRequest rejects non string requestId`() {
        try {
            PluginBridge.parseRequest(
                """
                    {
                        "pluginId": "device-info-plugin",
                        "command": "getDeviceInfo",
                        "requestId": 42
                    }
                """.trimIndent()
            )
            fail("Expected non-string requestId to throw")
        } catch (error: IllegalArgumentException) {
            assertEquals("requestId must be a string when provided", error.message)
        }
    }

    @Test
    fun `parseRequest rejects invalid JSON`() {
        try {
            PluginBridge.parseRequest("{")
            fail("Expected invalid JSON to throw")
        } catch (error: JSONException) {
            assertTrue(error.message?.isNotBlank() == true)
        }
    }

    @Test
    fun `parseRequest rejects non object data`() {
        try {
            PluginBridge.parseRequest(
                """
                    {
                        "pluginId": "device-info-plugin",
                        "command": "getDeviceInfo",
                        "data": "unsafe"
                    }
                """.trimIndent()
            )
            fail("Expected non-object data to throw")
        } catch (error: IllegalArgumentException) {
            assertEquals("data must be an object when provided", error.message)
        }
    }

    // ============================================================
    // emit() -- reachable branches only (see class header: the plugin
    // index is permanently empty in this checkout, so PLUGIN_NOT_FOUND is
    // the deepest emit() gets into real dispatch).
    // ============================================================

    @Test
    fun `emit with blank payload sends INVALID_PAYLOAD with system plugin id`() {
        val bridge = PluginBridge(activity, webView, properties)

        bridge.emit("   ")

        val js = captureEvaluatedJs()
        assertTrue(js.contains("PLUGIN_BRIDGE_ERROR"))
        assertTrue(js.contains("Payload is required"))
        assertTrue(js.contains("INVALID_PAYLOAD"))
        // request failed to parse entirely -> pluginId falls back to the
        // system plugin id, and there's no command to report.
        assertTrue(js.contains("__bridge__"))
    }

    @Test
    fun `emit with invalid JSON sends INVALID_PAYLOAD for JSONException`() {
        val bridge = PluginBridge(activity, webView, properties)

        bridge.emit("{")

        val js = captureEvaluatedJs()
        assertTrue(js.contains("Invalid JSON payload"))
        assertTrue(js.contains("INVALID_PAYLOAD"))
    }

    @Test
    fun `emit with missing pluginId sends INVALID_PAYLOAD and preserves command`() {
        val bridge = PluginBridge(activity, webView, properties)

        bridge.emit(
            """
                {
                    "command": "getDeviceInfo",
                    "requestId": "req-1"
                }
            """.trimIndent()
        )

        val js = captureEvaluatedJs()
        assertTrue(js.contains("pluginId is required"))
        assertTrue(js.contains("INVALID_PAYLOAD"))
        // pluginId parsed as empty string -> sendBridgeError falls back to
        // the system plugin id in the emitted JSON.
        assertTrue(js.contains("__bridge__"))
        assertTrue(js.contains("getDeviceInfo"))
        assertTrue(js.contains("req-1"))
    }

    @Test
    fun `emit with missing command sends INVALID_PAYLOAD and reports the real pluginId`() {
        val bridge = PluginBridge(activity, webView, properties)

        bridge.emit(
            """
                {
                    "pluginId": "device-info-plugin"
                }
            """.trimIndent()
        )

        val js = captureEvaluatedJs()
        assertTrue(js.contains("command is required"))
        assertTrue(js.contains("INVALID_PAYLOAD"))
        assertTrue(js.contains("device-info-plugin"))
    }

    @Test
    fun `emit with an unsupported plugin sends PLUGIN_NOT_FOUND`() {
        // GeneratedPluginIndex.pluginIdToClassName is empty in this
        // checkout (see class header), so every syntactically valid
        // pluginId is "unsupported" from PluginBridge's point of view --
        // this is the deepest emit() can currently reach into dispatch.
        val bridge = PluginBridge(activity, webView, properties)

        bridge.emit(
            """
                {
                    "pluginId": "device-info-plugin",
                    "command": "getDeviceInfo"
                }
            """.trimIndent()
        )

        val js = captureEvaluatedJs()
        assertTrue(js.contains("Unsupported plugin: device-info-plugin"))
        assertTrue(js.contains("PLUGIN_NOT_FOUND"))
        assertTrue(js.contains("device-info-plugin"))
        assertTrue(js.contains("getDeviceInfo"))
    }

    @Test
    fun `emit posts through webView exactly once per call`() {
        val bridge = PluginBridge(activity, webView, properties)

        bridge.emit("not json")

        verify(webView).post(any())
    }

    @Test
    fun `emit with null payload does not throw and reports INVALID_PAYLOAD`() {
        val bridge = PluginBridge(activity, webView, properties)

        bridge.emit(null)

        val js = captureEvaluatedJs()
        assertTrue(js.contains("Payload is required"))
    }

    // ============================================================
    // PluginBridgeContext.callback / toJavaScriptLiteral -- constructed
    // and exercised directly, independent of PluginBridge.emit().
    // ============================================================

    @Test
    fun `callback rejects a blank eventName`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "getDeviceInfo",
            requestId = "req-1"
        )

        try {
            context.callback("   ", null)
            fail("Expected blank eventName to throw")
        } catch (error: IllegalArgumentException) {
            assertEquals("Callback eventName is required", error.message)
        }

        verify(webView, never()).post(any())
    }

    @Test
    fun `callback with null data emits a null literal`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "getDeviceInfo",
            requestId = "req-1"
        )

        context.callback("deviceInfoResult", null)

        val js = captureEvaluatedJs()
        assertTrue(js.contains("\"device-info-plugin\""))
        assertTrue(js.contains("\"deviceInfoResult\""))
        assertTrue(js.contains(", null, \"req-1\", \"getDeviceInfo\""))
    }

    @Test
    fun `callback with JSONObject data embeds it literally`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "getDeviceInfo",
            requestId = null
        )

        val data = JSONObject().apply { put("battery", 42) }
        context.callback("deviceInfoResult", data)

        val js = captureEvaluatedJs()
        assertTrue(js.contains("{\"battery\":42}"))
        // requestId null -> literal "null", not a quoted string.
        assertTrue(js.contains(", null, "))
    }

    @Test
    fun `callback with JSONArray data embeds it literally`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "getDeviceInfo",
            requestId = "req-2"
        )

        val data = JSONArray().apply { put("a"); put("b") }
        context.callback("listResult", data)

        val js = captureEvaluatedJs()
        assertTrue(js.contains("[\"a\",\"b\"]"))
    }

    @Test
    fun `callback with numeric and boolean data embeds unquoted literals`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "getDeviceInfo",
            requestId = "req-3"
        )

        context.callback("countResult", 7)
        val numericJs = captureEvaluatedJs()
        assertTrue(numericJs.contains("callback(\"device-info-plugin\", \"countResult\", 7, "))

        context.callback("flagResult", true)
        verify(webView, org.mockito.kotlin.times(2)).post(any())
    }

    @Test
    fun `callback with String data quotes the literal`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "getDeviceInfo",
            requestId = "req-4"
        )

        context.callback("nameResult", "hello \"world\"")

        val js = captureEvaluatedJs()
        assertTrue(js.contains(JSONObject.quote("hello \"world\"")))
    }

    @Test
    fun `callback with a blank command literal falls back to null`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "  ",
            requestId = "req-5"
        )

        context.callback("result", null)

        val js = captureEvaluatedJs()
        assertTrue(js.endsWith("\"req-5\", null);"))
    }

    @Test
    fun `callback command override takes precedence over the context command`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "getDeviceInfo",
            requestId = "req-6"
        )

        context.callback("result", null, command = "overriddenCommand")

        val js = captureEvaluatedJs()
        assertTrue(js.contains("\"overriddenCommand\""))
        assertFalse(js.contains("\"getDeviceInfo\""))
    }

    @Test
    fun `context exposes activity as its Context`() {
        val context = PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = "device-info-plugin",
            command = "getDeviceInfo",
            requestId = null
        )

        assertEquals(activity, context.context)
    }
}
