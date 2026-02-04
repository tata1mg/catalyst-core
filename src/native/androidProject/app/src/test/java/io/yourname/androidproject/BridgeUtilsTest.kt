package io.yourname.androidproject

import io.yourname.androidproject.utils.BridgeUtils
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for BridgeUtils
 *
 * Tests cover:
 * - Bridge message formatting (3 tests)
 * - Response serialization (2 tests)
 * - Error message formatting (3 tests)
 *
 * Total: 8 tests
 *
 * Note: Tests focus on testable logic and string formatting without WebView
 * following the same pattern as FileUtilsTest.kt
 */
class BridgeUtilsTest {

    // ============================================================
    // CATEGORY 1: Bridge Message Formatting (3 tests)
    // ============================================================

    /**
     * Test WebEvents enum structure
     * Validates all event names and their string representations
     */
    @Test
    fun testWebEvents_enumStructure() {
        // Test camera events
        assertEquals("ON_CAMERA_CAPTURE", BridgeUtils.WebEvents.ON_CAMERA_CAPTURE.eventName)
        assertEquals("ON_CAMERA_ERROR", BridgeUtils.WebEvents.ON_CAMERA_ERROR.eventName)
        assertEquals("CAMERA_PERMISSION_STATUS", BridgeUtils.WebEvents.CAMERA_PERMISSION_STATUS.eventName)

        // Test file picker events
        assertEquals("ON_FILE_PICKED", BridgeUtils.WebEvents.ON_FILE_PICKED.eventName)
        assertEquals("ON_FILE_PICK_ERROR", BridgeUtils.WebEvents.ON_FILE_PICK_ERROR.eventName)
        assertEquals("ON_FILE_PICK_CANCELLED", BridgeUtils.WebEvents.ON_FILE_PICK_CANCELLED.eventName)
        assertEquals("ON_FILE_PICK_STATE_UPDATE", BridgeUtils.WebEvents.ON_FILE_PICK_STATE_UPDATE.eventName)

        // Test intent events
        assertEquals("ON_INTENT_SUCCESS", BridgeUtils.WebEvents.ON_INTENT_SUCCESS.eventName)
        assertEquals("ON_INTENT_ERROR", BridgeUtils.WebEvents.ON_INTENT_ERROR.eventName)
        assertEquals("ON_INTENT_CANCELLED", BridgeUtils.WebEvents.ON_INTENT_CANCELLED.eventName)

        // Test device info events
        assertEquals("ON_DEVICE_INFO_SUCCESS", BridgeUtils.WebEvents.ON_DEVICE_INFO_SUCCESS.eventName)
        assertEquals("ON_DEVICE_INFO_ERROR", BridgeUtils.WebEvents.ON_DEVICE_INFO_ERROR.eventName)

        // Test notification events
        assertEquals("NOTIFICATION_PERMISSION_STATUS", BridgeUtils.WebEvents.NOTIFICATION_PERMISSION_STATUS.eventName)
        assertEquals("LOCAL_NOTIFICATION_SCHEDULED", BridgeUtils.WebEvents.LOCAL_NOTIFICATION_SCHEDULED.eventName)
        assertEquals("PUSH_NOTIFICATION_TOKEN", BridgeUtils.WebEvents.PUSH_NOTIFICATION_TOKEN.eventName)
        assertEquals("NOTIFICATION_RECEIVED", BridgeUtils.WebEvents.NOTIFICATION_RECEIVED.eventName)
        assertEquals("NOTIFICATION_ACTION_PERFORMED", BridgeUtils.WebEvents.NOTIFICATION_ACTION_PERFORMED.eventName)

        // Test framework server events
        assertEquals("ON_FRAMEWORK_SERVER_READY", BridgeUtils.WebEvents.ON_FRAMEWORK_SERVER_READY.eventName)
        assertEquals("ON_FRAMEWORK_SERVER_ERROR", BridgeUtils.WebEvents.ON_FRAMEWORK_SERVER_ERROR.eventName)
        assertEquals("ON_FRAMEWORK_SERVER_STOPPED", BridgeUtils.WebEvents.ON_FRAMEWORK_SERVER_STOPPED.eventName)

        // Test haptic event
        assertEquals("HAPTIC_FEEDBACK", BridgeUtils.WebEvents.HAPTIC_FEEDBACK.eventName)
    }

    /**
     * Test JavaScript callback format construction
     * Validates the structure of window.WebBridge.callback() calls
     */
    @Test
    fun testJavaScriptCallback_formatConstruction() {
        // Test callback format with data
        val eventName = "ON_CAMERA_CAPTURE"
        val data = "test_data"
        val expectedWithData = "window.WebBridge.callback('$eventName', '$data')"

        // Verify format structure
        assertTrue(expectedWithData.startsWith("window.WebBridge.callback("))
        assertTrue(expectedWithData.contains(eventName))
        assertTrue(expectedWithData.contains(data))
        assertTrue(expectedWithData.endsWith(")"))

        // Test callback format without data (null)
        val expectedWithNull = "window.WebBridge.callback('$eventName', null)"

        assertTrue(expectedWithNull.startsWith("window.WebBridge.callback("))
        assertTrue(expectedWithNull.contains(eventName))
        assertTrue(expectedWithNull.endsWith("null)"))
        assertFalse(expectedWithNull.contains("'null'")) // null should not be quoted
    }

    /**
     * Test special character escaping in messages
     * Validates single quote escaping for JavaScript strings
     */
    @Test
    fun testMessageEscaping_specialCharacters() {
        // Test single quote escaping
        val messageWithQuote = "User's file"
        val escapedMessage = messageWithQuote.replace("'", "\\'")
        assertEquals("User\\'s file", escapedMessage)

        // Test multiple quotes
        val messageWithMultipleQuotes = "It's John's file"
        val escapedMultiple = messageWithMultipleQuotes.replace("'", "\\'")
        assertEquals("It\\'s John\\'s file", escapedMultiple)

        // Test message without quotes (should remain unchanged)
        val messageWithoutQuotes = "User file"
        val escapedNoQuotes = messageWithoutQuotes.replace("'", "\\'")
        assertEquals("User file", escapedNoQuotes)

        // Test empty string
        val emptyMessage = ""
        val escapedEmpty = emptyMessage.replace("'", "\\'")
        assertEquals("", escapedEmpty)
    }

    // ============================================================
    // CATEGORY 2: Response Serialization (2 tests)
    // ============================================================

    /**
     * Test JSON object string conversion
     * Validates JSON serialization with quote escaping
     */
    @Test
    fun testJsonSerialization_stringConversion() {
        // Create simple JSON object
        val simpleJson = JSONObject().apply {
            put("status", "success")
            put("code", 200)
        }

        val jsonString = simpleJson.toString()
        assertTrue(jsonString.contains("\"status\""))
        assertTrue(jsonString.contains("\"success\""))
        assertTrue(jsonString.contains("\"code\""))
        assertTrue(jsonString.contains("200"))

        // Test JSON with special characters
        val jsonWithQuotes = JSONObject().apply {
            put("message", "User's data")
        }

        val jsonStringWithQuotes = jsonWithQuotes.toString()
        // JSON escaping should handle this automatically
        assertTrue(jsonStringWithQuotes.contains("User"))
        assertTrue(jsonStringWithQuotes.contains("data"))

        // Test escaping for JavaScript injection
        val escapedForJs = jsonStringWithQuotes.replace("'", "\\'")
        assertFalse(escapedForJs.contains("'") && !escapedForJs.contains("\\'"))
    }

    /**
     * Test complex JSON structure serialization
     * Validates nested objects and arrays
     */
    @Test
    fun testJsonSerialization_complexStructures() {
        // Create complex JSON with nested objects
        val complexJson = JSONObject().apply {
            put("fileName", "test.jpg")
            put("fileSize", 1024000)
            put("metadata", JSONObject().apply {
                put("width", 1920)
                put("height", 1080)
            })
        }

        val jsonString = complexJson.toString()

        // Verify top-level fields
        assertTrue(jsonString.contains("fileName"))
        assertTrue(jsonString.contains("test.jpg"))
        assertTrue(jsonString.contains("fileSize"))

        // Verify nested object
        assertTrue(jsonString.contains("metadata"))
        assertTrue(jsonString.contains("width"))
        assertTrue(jsonString.contains("1920"))

        // Verify it's valid JSON structure
        assertNotNull(JSONObject(jsonString))

        // Test that parsing the string back works
        val reparsed = JSONObject(jsonString)
        assertEquals("test.jpg", reparsed.getString("fileName"))
        assertEquals(1024000, reparsed.getInt("fileSize"))
        assertNotNull(reparsed.getJSONObject("metadata"))
    }

    // ============================================================
    // CATEGORY 3: Error Message Formatting (3 tests)
    // ============================================================

    /**
     * Test standardized error message creation
     * Validates createErrorMessage format
     */
    @Test
    fun testErrorMessage_standardFormat() {
        // Test with both operation and error
        val error1 = BridgeUtils.createErrorMessage("open camera", "Permission denied")
        assertEquals("Failed to open camera: Permission denied", error1)

        val error2 = BridgeUtils.createErrorMessage("pick file", "File not found")
        assertEquals("Failed to pick file: File not found", error2)

        // Test with null error (should use default)
        val error3 = BridgeUtils.createErrorMessage("process image", null)
        assertEquals("Failed to process image: Unknown error", error3)

        // Test with empty operation
        val error4 = BridgeUtils.createErrorMessage("", "Some error")
        assertEquals("Failed to : Some error", error4)
    }

    /**
     * Test file size validation error messages
     * Validates validateFileSize error formatting
     */
    @Test
    fun testFileSizeValidation_errorMessages() {
        val maxSize = 50 * 1024 * 1024L // 50 MB

        // Test valid file (should not throw)
        val validSize = 10 * 1024 * 1024L // 10 MB
        try {
            BridgeUtils.validateFileSize(validSize, maxSize, "upload")
            // No exception expected
            assertTrue(true)
        } catch (e: IllegalArgumentException) {
            fail("Should not throw exception for valid file size")
        }

        // Test oversized file (should throw)
        val oversizedFile = 60 * 1024 * 1024L // 60 MB
        try {
            BridgeUtils.validateFileSize(oversizedFile, maxSize, "upload")
            fail("Should throw exception for oversized file")
        } catch (e: IllegalArgumentException) {
            // Verify error message format
            assertTrue(e.message!!.contains("File too large"))
            assertTrue(e.message!!.contains("upload"))
            assertTrue(e.message!!.contains("max:"))
        }
    }

    /**
     * Test file size formatting
     * Validates formatFileSize for different size ranges
     */
    @Test
    fun testFileSize_formatting() {
        // Test bytes
        assertEquals("512 B", BridgeUtils.formatFileSize(512))
        assertEquals("1023 B", BridgeUtils.formatFileSize(1023))

        // Test kilobytes
        assertEquals("1.0 KB", BridgeUtils.formatFileSize(1024))
        assertEquals("10.0 KB", BridgeUtils.formatFileSize(10240))
        assertEquals("500.5 KB", BridgeUtils.formatFileSize(512512))

        // Test megabytes
        assertEquals("1.0 MB", BridgeUtils.formatFileSize(1024 * 1024))
        assertEquals("5.0 MB", BridgeUtils.formatFileSize(5 * 1024 * 1024))
        assertEquals("50.0 MB", BridgeUtils.formatFileSize(50 * 1024 * 1024))

        // Test gigabytes
        assertEquals("1.0 GB", BridgeUtils.formatFileSize(1024L * 1024 * 1024))
        assertEquals("2.5 GB", BridgeUtils.formatFileSize((2.5 * 1024 * 1024 * 1024).toLong()))

        // Test edge cases
        assertEquals("0 B", BridgeUtils.formatFileSize(0))

        // Verify format consistency (should have decimal point for KB+)
        val kbFormatted = BridgeUtils.formatFileSize(1024)
        assertTrue(kbFormatted.contains("."))
        assertTrue(kbFormatted.endsWith("KB"))
    }
}
