package io.yourname.androidproject

import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for BridgeMessageValidator
 * Demonstrates validation behavior for all bridge commands
 */
class BridgeMessageValidatorTest {

    @Test
    fun `test valid openCamera message with all parameters`() {
        val message = JSONObject().apply {
            put("command", "openCamera")
            put("data", JSONObject().apply {
                put("quality", "high")
                put("allowsEditing", true)
                put("preferredCameraType", "back")
                put("flashMode", "auto")
                put("videoMaximumDuration", 60)
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertTrue(result.isValid)
        assertEquals("openCamera", result.command)
        assertNull(result.error)
    }

    @Test
    fun `test valid openCamera message with legacy string params`() {
        val message = JSONObject().apply {
            put("command", "openCamera")
            put("data", "legacy_options")
        }

        val result = BridgeMessageValidator.validate(message)
        assertTrue("Flexible commands should allow string params", result.isValid)
        assertEquals("openCamera", result.command)
    }

    @Test
    fun `test invalid openCamera with wrong quality enum`() {
        val message = JSONObject().apply {
            put("command", "openCamera")
            put("data", JSONObject().apply {
                put("quality", "ultra") // Invalid enum value
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertFalse(result.isValid)
        assertEquals("INVALID_ENUM_VALUE", result.error?.code)
    }

    @Test
    fun `test invalid openCamera with additional property`() {
        val message = JSONObject().apply {
            put("command", "openCamera")
            put("data", JSONObject().apply {
                put("quality", "high")
                put("unknownProperty", "value") // Additional property not allowed
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertFalse(result.isValid)
        assertEquals("ADDITIONAL_PROPERTY_NOT_ALLOWED", result.error?.code)
    }

    @Test
    fun `test valid requestHapticFeedback with required field`() {
        val message = JSONObject().apply {
            put("command", "requestHapticFeedback")
            put("data", JSONObject().apply {
                put("type", "VIRTUAL_KEY")
                put("intensity", 0.5)
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertTrue(result.isValid)
    }

    @Test
    fun `test invalid requestHapticFeedback missing required field`() {
        val message = JSONObject().apply {
            put("command", "requestHapticFeedback")
            put("data", JSONObject().apply {
                put("intensity", 0.5)
                // Missing required 'type' field
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertFalse(result.isValid)
        assertEquals("MISSING_REQUIRED_FIELD", result.error?.code)
    }

    @Test
    fun `test invalid requestHapticFeedback intensity above maximum`() {
        val message = JSONObject().apply {
            put("command", "requestHapticFeedback")
            put("data", JSONObject().apply {
                put("type", "VIRTUAL_KEY")
                put("intensity", 1.5) // Above maximum of 1
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertFalse(result.isValid)
        assertEquals("VALUE_ABOVE_MAXIMUM", result.error?.code)
    }

    @Test
    fun `test invalid requestHapticFeedback intensity below minimum`() {
        val message = JSONObject().apply {
            put("command", "requestHapticFeedback")
            put("data", JSONObject().apply {
                put("type", "VIRTUAL_KEY")
                put("intensity", -0.5) // Below minimum of 0
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertFalse(result.isValid)
        assertEquals("VALUE_BELOW_MINIMUM", result.error?.code)
    }

    @Test
    fun `test valid pickFile message`() {
        val message = JSONObject().apply {
            put("command", "pickFile")
            put("data", JSONObject().apply {
                put("mimeType", "image/*")
                put("multiple", true)
                put("minFiles", 1)
                put("maxFiles", 3)
                put("minFileSize", 1024)
                put("maxFileSize", 10485760)
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertTrue(result.isValid)
    }

    @Test
    fun `test valid getDeviceInfo with empty params`() {
        val message = JSONObject().apply {
            put("command", "getDeviceInfo")
            put("data", JSONObject())
        }

        val result = BridgeMessageValidator.validate(message)
        assertTrue(result.isValid)
    }

    @Test
    fun `test invalid command not in allowlist`() {
        val message = JSONObject().apply {
            put("command", "invalidCommand")
            put("data", JSONObject())
        }

        val result = BridgeMessageValidator.validate(message)
        assertFalse(result.isValid)
        assertEquals("UNSUPPORTED_COMMAND", result.error?.code)
    }

    @Test
    fun `test missing command field`() {
        val message = JSONObject().apply {
            put("data", JSONObject())
            // Missing 'command' field
        }

        val result = BridgeMessageValidator.validate(message)
        assertFalse(result.isValid)
        assertEquals("INVALID_ROOT_STRUCTURE", result.error?.code)
    }

    @Test
    fun `test valid message with optional timestamp and requestId`() {
        val message = JSONObject().apply {
            put("command", "getDeviceInfo")
            put("timestamp", "2025-10-01T12:00:00Z")
            put("requestId", "req-12345")
            put("data", JSONObject())
        }

        val result = BridgeMessageValidator.validate(message)
        assertTrue(result.isValid)
    }

    @Test
    fun `test invalid boolean type`() {
        val message = JSONObject().apply {
            put("command", "openCamera")
            put("data", JSONObject().apply {
                put("allowsEditing", "true") // String instead of boolean
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertFalse(result.isValid)
        assertEquals("INVALID_TYPE", result.error?.code)
    }

    @Test
    fun `test valid openFileWithIntent`() {
        val message = JSONObject().apply {
            put("command", "openFileWithIntent")
            put("data", JSONObject().apply {
                put("url", "https://example.com/file.pdf")
                put("mimeType", "application/pdf")
            })
        }

        val result = BridgeMessageValidator.validate(message)
        assertTrue(result.isValid)
    }

    @Test
    fun `test schema availability checks`() {
        assertTrue(BridgeMessageValidator.hasSchema("openCamera"))
        assertTrue(BridgeMessageValidator.hasSchema("requestHapticFeedback"))
        assertFalse(BridgeMessageValidator.hasSchema("nonExistentCommand"))

        val availableCommands = BridgeMessageValidator.getAvailableCommands()
        assertTrue(availableCommands.contains("openCamera"))
        assertTrue(availableCommands.contains("pickFile"))
        assertEquals(7, availableCommands.size)
    }
}
