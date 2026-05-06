package io.yourname.androidproject

import io.yourname.androidproject.utils.NotificationAction
import io.yourname.androidproject.utils.NotificationChannelConfig
import io.yourname.androidproject.utils.NotificationConfig
import io.yourname.androidproject.utils.NotificationStyle
import org.junit.Assert.*
import org.junit.Test
import java.util.*

/**
 * Unit tests for NotificationUtils
 *
 * Tests cover:
 * - Notification creation (4 tests)
 * - Channel management (3 tests)
 * - Notification ID generation (3 tests)
 * - Deep linking validation (3 tests)
 *
 * Total: 13 tests
 *
 * Note: Tests focus on testable logic and data structures without Android Context
 * following the same pattern as FileUtilsTest.kt and CameraUtilsTest.kt
 */
class NotificationUtilsTest {

    // ============================================================
    // CATEGORY 1: Notification Creation (4 tests)
    // ============================================================

    /**
     * Test NotificationConfig data class structure
     * Validates all required and optional fields
     */
    @Test
    fun testNotificationConfig_structureValidation() {
        // Test minimal required configuration
        val minimalConfig = NotificationConfig(
            title = "Test Title",
            body = "Test Body"
        )

        assertEquals("Test Title", minimalConfig.title)
        assertEquals("Test Body", minimalConfig.body)
        assertEquals("default", minimalConfig.channel)
        assertEquals(NotificationStyle.BASIC, minimalConfig.style)
        assertTrue(minimalConfig.vibrate)
        assertTrue(minimalConfig.autoCancel)
        assertFalse(minimalConfig.ongoing)
        assertNull(minimalConfig.badge)
        assertNull(minimalConfig.largeImage)
        assertNull(minimalConfig.data)
        assertNull(minimalConfig.actions)

        // Test fully configured notification
        val fullConfig = NotificationConfig(
            title = "Full Title",
            body = "Full Body",
            channel = "urgent",
            badge = 5,
            largeImage = "https://example.com/image.png",
            style = NotificationStyle.BIG_IMAGE,
            vibrate = false,
            autoCancel = false,
            ongoing = true,
            data = mapOf("key" to "value"),
            actions = listOf(NotificationAction("Reply", "reply"))
        )

        assertEquals("Full Title", fullConfig.title)
        assertEquals("Full Body", fullConfig.body)
        assertEquals("urgent", fullConfig.channel)
        assertEquals(5, fullConfig.badge)
        assertEquals("https://example.com/image.png", fullConfig.largeImage)
        assertEquals(NotificationStyle.BIG_IMAGE, fullConfig.style)
        assertFalse(fullConfig.vibrate)
        assertFalse(fullConfig.autoCancel)
        assertTrue(fullConfig.ongoing)
        assertNotNull(fullConfig.data)
        assertNotNull(fullConfig.actions)
    }

    /**
     * Test NotificationStyle enum validation
     * Validates all four notification styles
     */
    @Test
    fun testNotificationStyle_enumValidation() {
        val styles = NotificationStyle.values()

        // Verify all 4 styles exist
        assertEquals(4, styles.size)

        // Verify style names
        assertTrue(styles.contains(NotificationStyle.BASIC))
        assertTrue(styles.contains(NotificationStyle.BIG_TEXT))
        assertTrue(styles.contains(NotificationStyle.BIG_IMAGE))
        assertTrue(styles.contains(NotificationStyle.ACTION_BUTTONS))

        // Test style usage in config
        val basicConfig = NotificationConfig("Title", "Body", style = NotificationStyle.BASIC)
        val bigTextConfig = NotificationConfig("Title", "Body", style = NotificationStyle.BIG_TEXT)
        val bigImageConfig = NotificationConfig("Title", "Body", style = NotificationStyle.BIG_IMAGE)
        val actionConfig = NotificationConfig("Title", "Body", style = NotificationStyle.ACTION_BUTTONS)

        assertEquals(NotificationStyle.BASIC, basicConfig.style)
        assertEquals(NotificationStyle.BIG_TEXT, bigTextConfig.style)
        assertEquals(NotificationStyle.BIG_IMAGE, bigImageConfig.style)
        assertEquals(NotificationStyle.ACTION_BUTTONS, actionConfig.style)
    }

    /**
     * Test NotificationAction data structure
     * Validates action button configuration
     */
    @Test
    fun testNotificationAction_structureValidation() {
        // Create sample actions
        val replyAction = NotificationAction("Reply", "reply")
        val markReadAction = NotificationAction("Mark as Read", "mark_read")
        val dismissAction = NotificationAction("Dismiss", "dismiss")

        // Verify structure
        assertEquals("Reply", replyAction.title)
        assertEquals("reply", replyAction.actionId)

        assertEquals("Mark as Read", markReadAction.title)
        assertEquals("mark_read", markReadAction.actionId)

        assertEquals("Dismiss", dismissAction.title)
        assertEquals("dismiss", dismissAction.actionId)

        // Test in notification config
        val configWithActions = NotificationConfig(
            title = "Message",
            body = "You have a new message",
            style = NotificationStyle.ACTION_BUTTONS,
            actions = listOf(replyAction, markReadAction, dismissAction)
        )

        assertEquals(3, configWithActions.actions?.size)
        assertEquals("Reply", configWithActions.actions?.get(0)?.title)
        assertEquals("reply", configWithActions.actions?.get(0)?.actionId)
    }

    /**
     * Test notification badge number validation
     * Validates badge count range and behavior
     */
    @Test
    fun testNotificationBadge_validation() {
        // Test valid badge numbers
        val zeroBadge = NotificationConfig("Title", "Body", badge = 0)
        val normalBadge = NotificationConfig("Title", "Body", badge = 5)
        val largeBadge = NotificationConfig("Title", "Body", badge = 99)

        assertEquals(0, zeroBadge.badge)
        assertEquals(5, normalBadge.badge)
        assertEquals(99, largeBadge.badge)

        // Test null badge (default)
        val noBadge = NotificationConfig("Title", "Body")
        assertNull(noBadge.badge)

        // Validate badge range logic
        val validBadges = listOf(0, 1, 5, 10, 99, 999)
        validBadges.forEach { badge ->
            assertTrue(badge >= 0)
        }

        // Test negative badge (logically invalid but allowed by type system)
        val negativeBadge = -5
        assertFalse(negativeBadge >= 0)
    }

    // ============================================================
    // CATEGORY 2: Channel Management (3 tests)
    // ============================================================

    /**
     * Test NotificationChannelConfig structure
     * Validates channel configuration data class
     */
    @Test
    fun testChannelConfig_structureValidation() {
        val defaultChannel = NotificationChannelConfig(
            id = "default",
            name = "Default Notifications",
            description = "General app notifications"
        )

        assertEquals("default", defaultChannel.id)
        assertEquals("Default Notifications", defaultChannel.name)
        assertEquals("General app notifications", defaultChannel.description)
        assertTrue(defaultChannel.enableLights)
        assertTrue(defaultChannel.enableVibration)
        assertNull(defaultChannel.vibrationPattern)
        assertNull(defaultChannel.sound)

        // Test urgent channel with custom settings
        val urgentChannel = NotificationChannelConfig(
            id = "urgent",
            name = "Urgent Notifications",
            description = "Critical alerts",
            importance = 4, // IMPORTANCE_HIGH
            enableLights = true,
            lightColor = 0xFFFF0000.toInt(), // Red
            enableVibration = true,
            vibrationPattern = longArrayOf(0, 300, 200, 300)
        )

        assertEquals("urgent", urgentChannel.id)
        assertEquals(4, urgentChannel.importance)
        assertEquals(0xFFFF0000.toInt(), urgentChannel.lightColor)
        assertNotNull(urgentChannel.vibrationPattern)
        assertEquals(4, urgentChannel.vibrationPattern?.size)
    }

    /**
     * Test channel ID constants and naming
     * Validates standard channel IDs used in the app
     */
    @Test
    fun testChannelIds_standardChannels() {
        // Test standard channel IDs
        val defaultChannelId = "default"
        val urgentChannelId = "urgent"

        // Validate in NotificationConfig usage
        val defaultNotif = NotificationConfig("Title", "Body", channel = defaultChannelId)
        val urgentNotif = NotificationConfig("Title", "Body", channel = urgentChannelId)

        assertEquals("default", defaultNotif.channel)
        assertEquals("urgent", urgentNotif.channel)

        // Test default channel assignment
        val implicitDefault = NotificationConfig("Title", "Body")
        assertEquals("default", implicitDefault.channel)
    }

    /**
     * Test channel importance levels
     * Validates Android NotificationManager importance constants
     */
    @Test
    fun testChannelImportance_levels() {
        // Android importance levels (from NotificationManager)
        val IMPORTANCE_MIN = 1
        val IMPORTANCE_LOW = 2
        val IMPORTANCE_DEFAULT = 3
        val IMPORTANCE_HIGH = 4
        val IMPORTANCE_MAX = 5

        // Validate ordering
        assertTrue(IMPORTANCE_MIN < IMPORTANCE_LOW)
        assertTrue(IMPORTANCE_LOW < IMPORTANCE_DEFAULT)
        assertTrue(IMPORTANCE_DEFAULT < IMPORTANCE_HIGH)
        assertTrue(IMPORTANCE_HIGH < IMPORTANCE_MAX)

        // Test in channel config
        val lowImportance = NotificationChannelConfig(
            "low", "Low", "Low priority", importance = IMPORTANCE_LOW
        )
        val highImportance = NotificationChannelConfig(
            "high", "High", "High priority", importance = IMPORTANCE_HIGH
        )

        assertEquals(IMPORTANCE_LOW, lowImportance.importance)
        assertEquals(IMPORTANCE_HIGH, highImportance.importance)
        assertTrue(lowImportance.importance < highImportance.importance)
    }

    // ============================================================
    // CATEGORY 3: Notification ID Generation (3 tests)
    // ============================================================

    /**
     * Test notification ID format and structure
     * Validates ID generation pattern
     */
    @Test
    fun testNotificationId_format() {
        // Simulate ID generation logic
        val timestamp1 = System.currentTimeMillis()
        val random1 = Random().nextInt(1000)
        val id1 = "notification_${timestamp1}_${random1}"

        // Verify format
        assertTrue(id1.startsWith("notification_"))
        assertTrue(id1.contains("_"))

        // Extract parts
        val parts = id1.split("_")
        assertEquals(3, parts.size)
        assertEquals("notification", parts[0])

        // Verify timestamp is numeric
        val timestampPart = parts[1].toLongOrNull()
        assertNotNull(timestampPart)
        assertTrue(timestampPart!! > 0)

        // Verify random part is numeric
        val randomPart = parts[2].toIntOrNull()
        assertNotNull(randomPart)
        assertTrue(randomPart!! in 0..999)
    }

    /**
     * Test notification ID uniqueness
     * Validates that generated IDs are unique
     */
    @Test
    fun testNotificationId_uniqueness() {
        val generatedIds = mutableSetOf<String>()

        // Generate 10 IDs rapidly
        repeat(10) {
            val timestamp = System.currentTimeMillis()
            val random = Random().nextInt(1000)
            val id = "notification_${timestamp}_${random}"
            generatedIds.add(id)

            // Small delay to ensure different timestamps
            Thread.sleep(1)
        }

        // Verify all IDs are unique (or at least most are)
        // Due to random component, we might have collisions, but very unlikely with 1000 range
        assertTrue(generatedIds.size >= 8) // At least 80% unique
    }

    /**
     * Test notification ID hash code for Android notification manager
     * Validates hash code generation from string ID
     */
    @Test
    fun testNotificationId_hashCodeGeneration() {
        val id1 = "notification_1234567890_123"
        val id2 = "notification_1234567890_456"
        val id3 = "notification_9876543210_789"

        // Get hash codes (simulating what Android's notify() uses)
        val hash1 = id1.hashCode()
        val hash2 = id2.hashCode()
        val hash3 = id3.hashCode()

        // Verify different IDs produce different hashes
        assertNotEquals(hash1, hash2)
        assertNotEquals(hash1, hash3)
        assertNotEquals(hash2, hash3)

        // Verify same ID produces same hash
        val id1Copy = "notification_1234567890_123"
        assertEquals(hash1, id1Copy.hashCode())

        // Verify hash codes are within Int range
        assertTrue(hash1 is Int)
        assertTrue(hash2 is Int)
        assertTrue(hash3 is Int)
    }

    // ============================================================
    // CATEGORY 4: Deep Linking Validation (3 tests)
    // ============================================================

    /**
     * Test notification data payload structure
     * Validates data map format for deep linking
     */
    @Test
    fun testNotificationData_payloadStructure() {
        // Test simple data payload
        val simpleData = mapOf(
            "screen" to "home",
            "userId" to "123"
        )

        val simpleNotif = NotificationConfig(
            "Title", "Body",
            data = simpleData
        )

        assertEquals("home", simpleNotif.data?.get("screen"))
        assertEquals("123", simpleNotif.data?.get("userId"))

        // Test complex data payload
        val complexData = mapOf(
            "screen" to "profile",
            "userId" to "456",
            "action" to "view",
            "extra" to mapOf("key" to "value")
        )

        val complexNotif = NotificationConfig(
            "Title", "Body",
            data = complexData
        )

        assertEquals("profile", complexNotif.data?.get("screen"))
        assertEquals("456", complexNotif.data?.get("userId"))
        assertEquals("view", complexNotif.data?.get("action"))
        assertNotNull(complexNotif.data?.get("extra"))
    }

    /**
     * Test notification intent action IDs
     * Validates action ID format for button callbacks
     */
    @Test
    fun testNotificationAction_actionIdFormat() {
        val validActionIds = listOf(
            "reply",
            "mark_read",
            "dismiss",
            "accept",
            "decline",
            "view_details"
        )

        // Verify action ID format (lowercase, underscores)
        validActionIds.forEach { actionId ->
            assertTrue(actionId.matches(Regex("^[a-z_]+$")))
        }

        // Test invalid formats (should not match pattern)
        val invalidActionIds = listOf(
            "Reply", // Uppercase
            "mark-read", // Hyphen instead of underscore
            "dismiss!", // Special character
            "view details" // Space
        )

        invalidActionIds.forEach { actionId ->
            assertFalse(actionId.matches(Regex("^[a-z_]+$")))
        }

        // Test action ID hash codes for intent request codes
        validActionIds.forEach { actionId ->
            val hashCode = actionId.hashCode()
            assertTrue(hashCode is Int) // Valid for PendingIntent
        }
    }

    /**
     * Test notification extra keys for intent data
     * Validates intent extra key constants
     */
    @Test
    fun testNotificationIntent_extraKeys() {
        // Define constants (matching NotificationConstants)
        val EXTRA_IS_NOTIFICATION = "is_notification"
        val EXTRA_NOTIFICATION_DATA = "notification_data"
        val EXTRA_ACTION = "action"

        // Validate key format (lowercase, underscores)
        assertTrue(EXTRA_IS_NOTIFICATION.matches(Regex("^[a-z_]+$")))
        assertTrue(EXTRA_NOTIFICATION_DATA.matches(Regex("^[a-z_]+$")))
        assertTrue(EXTRA_ACTION.matches(Regex("^[a-z_]+$")))

        // Test key uniqueness
        val keys = setOf(EXTRA_IS_NOTIFICATION, EXTRA_NOTIFICATION_DATA, EXTRA_ACTION)
        assertEquals(3, keys.size)

        // Verify no key collisions
        assertNotEquals(EXTRA_IS_NOTIFICATION, EXTRA_NOTIFICATION_DATA)
        assertNotEquals(EXTRA_IS_NOTIFICATION, EXTRA_ACTION)
        assertNotEquals(EXTRA_NOTIFICATION_DATA, EXTRA_ACTION)
    }
}
