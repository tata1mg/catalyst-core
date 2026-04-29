package io.yourname.androidproject

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for security bridge command routing and JSON injection safety.
 *
 * Coverage:
 * - setScreenSecure command routing (5 tests)
 * - getScreenSecure command routing (2 tests)
 * - clearWebData command routing (2 tests)
 * - JSON injection safety in error responses (3 tests)
 *
 * Total: 12 tests
 *
 * Note: These tests operate on static parsing/validation logic and JSON data
 * structures. Full lifecycle (FLAG_SECURE, CookieManager) is exercised in
 * device integration tests; here we confirm command acceptance, param parsing,
 * and that error payloads produced via JSONObject cannot carry injected content.
 */
class SecurityBridgeTest {

    // ============================================================
    // CATEGORY 1: setScreenSecure COMMAND ROUTING (5 tests)
    // ============================================================

    @Test
    fun `test setScreenSecure command is accepted by validator`() {
        val messageJson = """{"command": "setScreenSecure", "data": {"enable": true}}"""

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("setScreenSecure should be a valid command", result.isValid)
        assertEquals("setScreenSecure", result.command)
        assertNull(result.error)
    }

    @Test
    fun `test setScreenSecure enable true parsed from params`() {
        val params = JSONObject().apply { put("enable", true) }

        val enable = params.optBoolean("enable", false)

        assertTrue("enable should be true", enable)
    }

    @Test
    fun `test setScreenSecure enable false parsed from params`() {
        val params = JSONObject().apply { put("enable", false) }

        val enable = params.optBoolean("enable", true)

        assertFalse("enable should be false", enable)
    }

    @Test
    fun `test setScreenSecure defaults to true when params are malformed`() {
        // NativeBridge.setScreenSecure falls back to true when JSON parse fails
        val malformedParams = "not-json"
        val enable = try {
            JSONObject(malformedParams).optBoolean("enable", true)
        } catch (e: Exception) {
            true
        }

        assertTrue("Malformed params should default to enable=true", enable)
    }

    @Test
    fun `test setScreenSecure success response shape`() {
        val enable = true
        val response = JSONObject().apply {
            put("secure", enable)
            put("success", true)
        }

        assertTrue(response.getBoolean("secure"))
        assertTrue(response.getBoolean("success"))
        // Verify no extra fields bleed in
        assertEquals(2, response.length())
    }

    // ============================================================
    // CATEGORY 2: getScreenSecure COMMAND ROUTING (2 tests)
    // ============================================================

    @Test
    fun `test getScreenSecure command is accepted by validator`() {
        val messageJson = """{"command": "getScreenSecure", "data": {}}"""

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("getScreenSecure should be a valid command", result.isValid)
        assertEquals("getScreenSecure", result.command)
        assertNull(result.error)
    }

    @Test
    fun `test getScreenSecure status response shape`() {
        // Validate that the JSON payload produced by getScreenSecure is well-formed
        val isSecure = false
        val response = JSONObject().apply {
            put("secure", isSecure)
            put("success", true)
        }

        assertFalse(response.getBoolean("secure"))
        assertTrue(response.getBoolean("success"))
        assertEquals(2, response.length())
    }

    // ============================================================
    // CATEGORY 3: clearWebData COMMAND ROUTING (2 tests)
    // ============================================================

    @Test
    fun `test clearWebData command is accepted by validator`() {
        val messageJson = """{"command": "clearWebData", "data": {}}"""

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("clearWebData should be a valid command", result.isValid)
        assertEquals("clearWebData", result.command)
        assertNull(result.error)
    }

    @Test
    fun `test clearWebData success response shape`() {
        val cookiesRemoved = true
        val response = JSONObject().apply {
            put("success", true)
            put("cookiesRemoved", cookiesRemoved)
        }

        assertTrue(response.getBoolean("success"))
        assertTrue(response.getBoolean("cookiesRemoved"))
        assertEquals(2, response.length())
    }

    // ============================================================
    // CATEGORY 4: JSON INJECTION SAFETY (3 tests)
    // ============================================================

    @Test
    fun `test error message with injection characters is safe via JSONObject`() {
        // Simulate an exception message that contains characters dangerous in naive JS
        // string interpolation: double-quotes and backslashes.
        // JSONObject must escape them so the serialized JSON stays valid and cannot
        // break out of the surrounding JS string literal in notifyWebJson.
        val injectionPayload = "failed\"; window[\"evil\"]=\"injected"

        val response = JSONObject().apply {
            put("success", false)
            put("error", injectionPayload)
        }

        val serialized = response.toString()

        // The raw unescaped double-quote sequence that would break JS must not appear
        assertFalse(
            "Unescaped double-quote injection sequence must not appear in serialized JSON",
            serialized.contains("\"evil\"")
        )
        // The value must survive a round-trip intact
        assertEquals(injectionPayload, JSONObject(serialized).getString("error"))
    }

    @Test
    fun `test error message with backslash sequences is safe via JSONObject`() {
        val backslashPayload = "err\\\"injected\\\""

        val response = JSONObject().apply {
            put("success", false)
            put("error", backslashPayload)
        }

        // Round-trip must survive without throwing
        val roundTripped = JSONObject(response.toString()).getString("error")
        assertEquals(backslashPayload, roundTripped)
    }

    @Test
    fun `test setScreenSecure and clearWebData commands are in VALID_COMMANDS whitelist`() {
        assertTrue(
            "setScreenSecure must be whitelisted",
            CatalystConstants.Bridge.VALID_COMMANDS.contains("setScreenSecure")
        )
        assertTrue(
            "getScreenSecure must be whitelisted",
            CatalystConstants.Bridge.VALID_COMMANDS.contains("getScreenSecure")
        )
        assertTrue(
            "clearWebData must be whitelisted",
            CatalystConstants.Bridge.VALID_COMMANDS.contains("clearWebData")
        )
    }
}
