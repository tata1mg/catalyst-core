package io.yourname.androidproject.plugins

import io.yourname.androidproject.CatalystConstants
import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PluginBridgeTest {

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
}
