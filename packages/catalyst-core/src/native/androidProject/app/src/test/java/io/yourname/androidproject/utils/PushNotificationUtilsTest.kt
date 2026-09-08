package io.yourname.androidproject.utils

import android.content.Context
import android.webkit.WebView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mockito.kotlin.mock

/**
 * Unit tests for PushNotificationUtils (Android coverage batch 4),
 * previously entirely untested (0/18 lines).
 *
 * Source-set note: this project swaps PushNotificationUtils between two
 * source sets (noFcm/withFcm) based on buildIos/config.js's
 * isNotificationsEnabled() check in app/build.gradle.kts. Verified
 * empirically for this checkout: no catalyst-build.properties file exists,
 * so isNotificationsEnabled() falls back to its default (false), and the
 * noFcm variant is what actually compiles for testDebugUnitTest -- confirmed
 * both by the noFcm-only compiler warnings during `./gradlew
 * testDebugUnitTest` and by `app/build/tmp/kotlin-classes/debug` containing
 * only io/yourname/androidproject/utils/PushNotificationUtils(.class|
 * $Companion.class) built from the noFcm source file. This test file
 * therefore targets app/src/noFcm/java/.../PushNotificationUtils.kt, a
 * trivial no-op stub (Firebase disabled) whose methods only log via
 * BridgeUtils.logInfo/logWarning (which call android.util.Log directly --
 * safe under the mockable android.jar's isReturnDefaultValues=true, no
 * static mocking needed) and otherwise return hardcoded
 * false/null/empty/"none"/"" values.
 *
 * Out of scope: app/src/withFcm/java/.../PushNotificationUtils.kt (the real
 * Firebase-backed implementation) is not compiled under the current build
 * config in this checkout, so it is untestable from testDebugUnitTest here
 * and is not covered by this file.
 */
class PushNotificationUtilsTest {

    private val context: Context = mock()
    private val utils = PushNotificationUtils()

    @Test
    fun `initializeAndGetToken always returns empty string`() {
        assertEquals("", utils.initializeAndGetToken(context))
    }

    @Test
    fun `handleIncomingPush is a no-op with a real webView`() {
        val webView: WebView = mock()
        // Should not throw; no-op stub only logs.
        utils.handleIncomingPush(webView, context, mapOf("key" to "value"))
    }

    @Test
    fun `handleIncomingPush is a no-op with a null webView`() {
        utils.handleIncomingPush(null, context, emptyMap())
    }

    @Test
    fun `handleTokenRefresh is a no-op with a real webView`() {
        val webView: WebView = mock()
        utils.handleTokenRefresh(webView, "some-token")
    }

    @Test
    fun `handleTokenRefresh is a no-op with a null webView`() {
        utils.handleTokenRefresh(null, "some-token")
    }

    @Test
    fun `subscribeToTopic always returns false`() {
        assertFalse(utils.subscribeToTopic(context, "topic"))
    }

    @Test
    fun `unsubscribeFromTopic always returns false`() {
        assertFalse(utils.unsubscribeFromTopic(context, "topic"))
    }

    @Test
    fun `getPushToken always returns null`() {
        assertNull(utils.getPushToken(context))
    }

    @Test
    fun `getSubscribedTopics always returns an empty set`() {
        assertTrue(utils.getSubscribedTopics(context).isEmpty())
    }

    @Test
    fun `deleteAllPushData always returns false`() {
        assertFalse(utils.deleteAllPushData(context))
    }

    @Test
    fun `getPushProvider always returns none`() {
        assertEquals("none", utils.getPushProvider(context))
    }

    @Test
    fun `isAvailable always returns false`() {
        assertFalse(utils.isAvailable(context))
    }

    @Test
    fun `companion action and extra constants have expected values`() {
        assertEquals(
            "io.yourname.androidproject.PUSH_MESSAGE_RECEIVED",
            PushNotificationUtils.ACTION_MESSAGE_RECEIVED
        )
        assertEquals(
            "io.yourname.androidproject.PUSH_TOKEN_REFRESHED",
            PushNotificationUtils.ACTION_TOKEN_REFRESHED
        )
        assertEquals("message_data", PushNotificationUtils.EXTRA_MESSAGE_DATA)
        assertEquals("token", PushNotificationUtils.EXTRA_TOKEN)
    }
}
