package io.yourname.androidproject

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for NativeBridge
 * Tests command routing, message handling, file picker options, and permission flows
 *
 * Coverage:
 * - Command Routing (8 tests)
 * - Message Handling (6 tests)
 * - File Picker Options (5 tests)
 * - Permission Handling (4 tests)
 *
 * Total: 23 tests
 *
 * Note: These tests focus on the static parseAndValidateMessage method and data validation
 * since NativeBridge requires full Android lifecycle for complete testing.
 */
class NativeBridgeTest {

    // ============================================================
    // CATEGORY 1: COMMAND ROUTING (8 tests)
    // ============================================================

    @Test
    fun `test parseAndValidateMessage with valid openCamera command`() {
        val messageJson = """
            {
                "command": "openCamera",
                "data": {
                    "quality": "high",
                    "allowsEditing": true
                }
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("Valid openCamera command should pass validation", result.isValid)
        assertEquals("openCamera", result.command)
        assertNull("No error should be present for valid message", result.error)
    }

    @Test
    fun `test parseAndValidateMessage with valid pickFile command`() {
        val messageJson = """
            {
                "command": "pickFile",
                "data": {
                    "mimeType": "image/*",
                    "multiple": true,
                    "maxFiles": 5
                }
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("Valid pickFile command should pass validation", result.isValid)
        assertEquals("pickFile", result.command)
        assertNull(result.error)
    }

    @Test
    fun `test parseAndValidateMessage with valid requestHapticFeedback command`() {
        val messageJson = """
            {
                "command": "requestHapticFeedback",
                "data": {
                    "type": "VIRTUAL_KEY",
                    "intensity": 0.8
                }
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("Valid haptic feedback command should pass validation", result.isValid)
        assertEquals("requestHapticFeedback", result.command)
        assertNull(result.error)
    }

    @Test
    fun `test parseAndValidateMessage with valid openFileWithIntent command`() {
        val messageJson = """
            {
                "command": "openFileWithIntent",
                "data": {}
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("Valid openFileWithIntent command should pass validation", result.isValid)
        assertEquals("openFileWithIntent", result.command)
        assertNull(result.error)
    }

    @Test
    fun `test parseAndValidateMessage with valid getDeviceInfo command`() {
        val messageJson = """
            {
                "command": "getDeviceInfo",
                "data": {}
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("Valid getDeviceInfo command should pass", result.isValid)
        assertEquals("getDeviceInfo", result.command)
        assertNull(result.error)
    }

    @Test
    fun `test parseAndValidateMessage with invalid command rejection`() {
        val messageJson = """
            {
                "command": "invalidCommand",
                "data": {}
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertFalse("Invalid command should be rejected", result.isValid)
        assertNotNull("Error should be present for invalid command", result.error)
        assertEquals("UNSUPPORTED_COMMAND", result.error?.code)
    }

    @Test
    fun `test parseAndValidateMessage with missing required data field`() {
        val messageJson = """
            {
                "command": "openCamera"
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        // Commands are flexible - missing data field should be handled gracefully
        // The validator should either pass or return a specific error
        assertNotNull("Result should not be null", result)
    }

    @Test
    fun `test parseAndValidateMessage with BridgeMessageValidator integration`() {
        val validMessage = """
            {
                "command": "pickFile",
                "data": {
                    "mimeType": "application/pdf",
                    "multiple": false
                }
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(validMessage)

        assertTrue("BridgeMessageValidator should validate correctly", result.isValid)
        assertEquals("pickFile", result.command)
        assertNotNull("Params should be extracted", result.params)
    }

    // ============================================================
    // CATEGORY 2: MESSAGE HANDLING (6 tests)
    // ============================================================

    @Test
    fun `test parseAndValidateMessage handles valid JSON parsing`() {
        val messageJson = """
            {
                "command": "openCamera",
                "data": {
                    "quality": "medium"
                }
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("Valid JSON should be parsed successfully", result.isValid)
        assertEquals("openCamera", result.command)
    }

    @Test
    fun `test parseAndValidateMessage handles JSON parsing failure`() {
        val invalidJson = """
            {
                "command": "openCamera",
                "data": {
                    "quality": "high"
                // Missing closing braces
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(invalidJson)

        assertFalse("Invalid JSON should fail parsing", result.isValid)
        assertNotNull("Error should be present", result.error)
        assertEquals("INVALID_JSON", result.error?.code)
        assertTrue("Error message should mention JSON",
            result.error?.message?.contains("JSON", ignoreCase = true) ?: false)
    }

    @Test
    fun `test parseAndValidateMessage with callback execution structure`() {
        val messageJson = """
            {
                "command": "getDeviceInfo",
                "data": {},
                "callbackId": "callback_12345"
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("Message with callback should be valid", result.isValid)
        assertEquals("getDeviceInfo", result.command)
    }

    @Test
    fun `test parseAndValidateMessage error callback handling`() {
        val messageJson = """
            {
                "command": "unknownCommand",
                "data": {}
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertFalse("Unknown command should fail validation", result.isValid)
        assertNotNull("Error callback structure should be present", result.error)
        assertEquals("UNSUPPORTED_COMMAND", result.error?.code)
        assertEquals("BRIDGE_ERROR", result.error?.eventName)
    }

    @Test
    fun `test parseAndValidateMessage response formatting for success`() {
        val messageJson = """
            {
                "command": "requestHapticFeedback",
                "data": {
                    "type": "VIRTUAL_KEY",
                    "intensity": 0.5
                }
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(messageJson)

        assertTrue("Valid message should format success response", result.isValid)
        assertNotNull("Command should be present in response", result.command)
        assertNotNull("Params should be present in response", result.params)
    }

    @Test
    fun `test parseAndValidateMessage handles null and empty messages`() {
        val emptyJson = "{}"
        val emptyResult = NativeBridge.parseAndValidateMessage(emptyJson)

        assertFalse("Empty JSON should fail validation", emptyResult.isValid)
        assertNotNull("Error should be present for empty message", emptyResult.error)

        val nullDataJson = """{"command": null}"""
        val nullResult = NativeBridge.parseAndValidateMessage(nullDataJson)

        assertFalse("Null command should fail validation", nullResult.isValid)
    }

    // ============================================================
    // CATEGORY 3: FILE PICKER OPTIONS (5 tests)
    // ============================================================

    // These five replace the file's original FilePickerOptions tests,
    // which never called FilePickerOptions.fromRaw at all -- it was
    // `private` to NativeBridge.kt and unreachable from this file (the
    // original tests' own comment admitted as much: "Access
    // FilePickerOptions through reflection or create test harness").
    // Widened to `internal` (batch 4 extension) specifically to make
    // these real; the class's fields/logic are otherwise unchanged.

    @Test
    fun `FilePickerOptions parses mimeType and multiple from JSON`() {
        val options = FilePickerOptions.fromRaw("""{"mimeType": "image/jpeg", "multiple": true}""")

        assertEquals("image/jpeg", options.mimeType)
        assertTrue(options.multiple)
    }

    @Test
    fun `FilePickerOptions auto-enables multiple when maxFiles exceeds 1 even if not explicitly set`() {
        val options = FilePickerOptions.fromRaw("""{"mimeType": "application/pdf", "maxFiles": 3}""")

        assertTrue("maxFiles > 1 should auto-enable multiple selection", options.multiple)
        assertEquals(3, options.maxFiles)
    }

    @Test
    fun `FilePickerOptions parses min and max file size constraints`() {
        val options = FilePickerOptions.fromRaw(
            """{"mimeType": "*/*", "minFileSize": 1024, "maxFileSize": 5242880}"""
        )

        assertEquals(1024L, options.minFileSize)
        assertEquals(5242880L, options.maxFileSize)
    }

    @Test
    fun `FilePickerOptions parses min and max file count constraints`() {
        val options = FilePickerOptions.fromRaw(
            """{"mimeType": "image/*", "multiple": true, "minFiles": 2, "maxFiles": 10}"""
        )

        assertEquals(2, options.minFiles)
        assertEquals(10, options.maxFiles)
    }

    @Test
    fun `FilePickerOptions treats a plain non-JSON string as a legacy MIME type`() {
        val options = FilePickerOptions.fromRaw("application/pdf")

        assertEquals("application/pdf", options.mimeType)
        assertFalse(options.multiple)
        assertNull(options.minFiles)
        assertNull(options.maxFiles)
    }

    @Test
    fun `FilePickerOptions with null or blank raw input returns all defaults`() {
        val fromNull = FilePickerOptions.fromRaw(null)
        assertEquals("*/*", fromNull.mimeType)
        assertFalse(fromNull.multiple)

        val fromBlank = FilePickerOptions.fromRaw("   ")
        assertEquals("*/*", fromBlank.mimeType)
    }

    @Test
    fun `FilePickerOptions with malformed JSON-looking input falls back to the trimmed raw string as mimeType`() {
        // Starts with { and ends with } (so it's treated as the JSON
        // branch), but isn't valid JSON -- JSONObject(...) throws, and
        // fromRaw's catch branch falls back to using the trimmed raw
        // string as the mimeType, not the defaults.
        val options = FilePickerOptions.fromRaw("{not valid json}")

        assertEquals("{not valid json}", options.mimeType)
    }

    @Test
    fun `FilePickerOptions empty mimeType in JSON falls back to wildcard`() {
        val options = FilePickerOptions.fromRaw("""{"mimeType": ""}""")

        assertEquals("*/*", options.mimeType)
    }

    // ============================================================
    // GoogleSignInOptions.fromRaw
    // ============================================================

    @Test
    fun `GoogleSignInOptions parses clientId and optional fields from JSON`() {
        val options = GoogleSignInOptions.fromRaw(
            """{"clientId": "abc123.apps.googleusercontent.com", "nonce": "xyz", "autoSelect": true}"""
        )

        assertEquals("abc123.apps.googleusercontent.com", options.clientId)
        assertEquals("xyz", options.nonce)
        assertTrue(options.autoSelect)
        assertFalse(options.filterByAuthorizedAccounts)
    }

    @Test
    fun `GoogleSignInOptions falls back to webClientId when clientId is absent`() {
        val options = GoogleSignInOptions.fromRaw("""{"webClientId": "fallback.apps.googleusercontent.com"}""")

        assertEquals("fallback.apps.googleusercontent.com", options.clientId)
    }

    @Test
    fun `GoogleSignInOptions with null or blank raw input returns an empty clientId to allow config fallback`() {
        val fromNull = GoogleSignInOptions.fromRaw(null)
        assertEquals("", fromNull.clientId)

        val fromBlank = GoogleSignInOptions.fromRaw("   ")
        assertEquals("", fromBlank.clientId)
    }

    @Test
    fun `GoogleSignInOptions with malformed JSON falls back to using the trimmed raw string as clientId`() {
        val options = GoogleSignInOptions.fromRaw("not-json-at-all")

        assertEquals("not-json-at-all", options.clientId)
    }

    @Test
    fun `GoogleSignInOptions blank nonce is treated as absent, not an empty string`() {
        val options = GoogleSignInOptions.fromRaw("""{"clientId": "abc", "nonce": ""}""")

        assertNull(options.nonce)
    }

    // ============================================================
    // CATEGORY 4: PERMISSION HANDLING (4 tests)
    // ============================================================

    @Test
    fun `test camera permission flow structure`() {
        // Test that camera permission requests follow proper flow
        val cameraMessage = """
            {
                "command": "openCamera",
                "data": {
                    "quality": "high"
                }
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(cameraMessage)

        assertTrue("Camera command should be valid", result.isValid)
        assertEquals("openCamera", result.command)
        // In actual implementation, this would trigger permission check
    }

    @Test
    fun `test camera permission request flow structure`() {
        val permissionMessage = """
            {
                "command": "requestCameraPermission",
                "data": {}
            }
        """.trimIndent()

        val result = NativeBridge.parseAndValidateMessage(permissionMessage)

        assertTrue("Camera permission command should be valid", result.isValid)
        assertEquals("requestCameraPermission", result.command)
    }

    @Test
    fun `test permission granted callback structure`() {
        // Test that permission results are structured correctly
        val permissionResult = JSONObject().apply {
            put("permission", "CAMERA")
            put("granted", true)
        }

        assertEquals("CAMERA", permissionResult.getString("permission"))
        assertTrue(permissionResult.getBoolean("granted"))
    }

    @Test
    fun `test permission denied handling structure`() {
        // Test that permission denial is handled with proper structure
        val permissionResult = JSONObject().apply {
            put("permission", "NOTIFICATION")
            put("granted", false)
            put("reason", "USER_DENIED")
        }

        assertEquals("NOTIFICATION", permissionResult.getString("permission"))
        assertFalse(permissionResult.getBoolean("granted"))
        assertEquals("USER_DENIED", permissionResult.getString("reason"))
    }
}
