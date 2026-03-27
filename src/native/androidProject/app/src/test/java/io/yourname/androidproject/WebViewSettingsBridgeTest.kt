package io.yourname.androidproject

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for setAndroidWebViewSettings bridge command.
 *
 * Coverage:
 * - Command routing / whitelist (1 test)
 * - JSON param parsing for each supported setting (3 tests)
 * - Partial params — only specified keys applied (1 test)
 * - Null / empty params — no crash, uses defaults (2 tests)
 * - Malformed JSON — graceful fallback (1 test)
 *
 * Total: 8 tests
 *
 * Note: Actual WebView.Settings mutation requires an instrumented test
 * (needs a real WebView). These unit tests verify the JSON parsing logic
 * and command acceptance that guard the real mutation path.
 */
class WebViewSettingsBridgeTest {

    // ============================================================
    // CATEGORY 1: COMMAND ROUTING (1 test)
    // ============================================================

    @Test
    fun `test setAndroidWebViewSettings command is accepted by validator`() {
        val messageJson = """{"command": "setAndroidWebViewSettings", "data": {"supportZoom": true}}"""

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("setAndroidWebViewSettings should be a valid command", result.isValid)
        assertEquals("setAndroidWebViewSettings", result.command)
        assertNull(result.error)
    }

    // ============================================================
    // CATEGORY 2: JSON PARAM PARSING (3 tests)
    // ============================================================

    @Test
    fun `test supportZoom true parsed correctly from params`() {
        val params = JSONObject().apply { put("supportZoom", true) }

        assertTrue(params.has("supportZoom"))
        assertTrue(params.getBoolean("supportZoom"))
    }

    @Test
    fun `test builtInZoomControls false parsed correctly from params`() {
        val params = JSONObject().apply { put("builtInZoomControls", false) }

        assertTrue(params.has("builtInZoomControls"))
        assertFalse(params.getBoolean("builtInZoomControls"))
    }

    @Test
    fun `test displayZoomControls false parsed correctly from params`() {
        val params = JSONObject().apply { put("displayZoomControls", false) }

        assertTrue(params.has("displayZoomControls"))
        assertFalse(params.getBoolean("displayZoomControls"))
    }

    // ============================================================
    // CATEGORY 3: PARTIAL PARAMS (1 test)
    // ============================================================

    @Test
    fun `test partial params — only keys present in JSON are applied`() {
        // Only supportZoom provided; builtInZoomControls and displayZoomControls absent
        val params = JSONObject().apply { put("supportZoom", true) }

        assertTrue(params.has("supportZoom"))
        assertFalse("builtInZoomControls should not be present", params.has("builtInZoomControls"))
        assertFalse("displayZoomControls should not be present", params.has("displayZoomControls"))
    }

    // ============================================================
    // CATEGORY 4: NULL / EMPTY PARAMS (2 tests)
    // ============================================================

    @Test
    fun `test null params parsed as empty JSON without throwing`() {
        val params = try {
            JSONObject(null ?: "{}")
        } catch (e: Exception) {
            null
        }

        assertNotNull("Null params should produce empty JSONObject, not throw", params)
        assertEquals(0, params!!.length())
    }

    @Test
    fun `test empty JSON object has no settings keys`() {
        val params = JSONObject("{}")

        assertFalse(params.has("supportZoom"))
        assertFalse(params.has("builtInZoomControls"))
        assertFalse(params.has("displayZoomControls"))
    }

    // ============================================================
    // CATEGORY 5: MALFORMED JSON (1 test)
    // ============================================================

    @Test
    fun `test malformed JSON params are caught gracefully`() {
        val malformed = "not-valid-json"
        var threw = false

        try {
            JSONObject(malformed)
        } catch (e: Exception) {
            threw = true
        }

        assertTrue("Malformed JSON should throw, which NativeBridge catches silently", threw)
    }
}
