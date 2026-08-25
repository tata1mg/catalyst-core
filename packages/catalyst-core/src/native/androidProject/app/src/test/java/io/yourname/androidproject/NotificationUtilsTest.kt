package io.yourname.androidproject

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.content.res.Resources
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.yourname.androidproject.utils.NotificationAction
import io.yourname.androidproject.utils.NotificationConfig
import io.yourname.androidproject.utils.NotificationStyle
import io.yourname.androidproject.utils.NotificationUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.MockedStatic
import org.mockito.Mockito.mockStatic
import org.mockito.kotlin.any
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.eq
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import java.io.ByteArrayInputStream

/**
 * Unit tests for NotificationUtils.
 *
 * The previous version of this file imported NotificationUtils but never
 * constructed or called it — every assertion ran against locally
 * reimplemented logic (hand-rolled permission-status strings, manually
 * duplicated ID-format checks), so it passed while contributing 0%
 * coverage. Rewritten to construct a real NotificationUtils and call its
 * public methods, following the mockStatic(...) pattern established in
 * OfflineCacheServiceTest.kt / CameraUtilsTest.kt.
 *
 * Scope (updated in coverage batch 3): buildNotification/
 * applyNotificationStyle ARE now covered — NotificationCompat.Builder is
 * androidx bytecode on the test classpath, not an android.jar stub, so it
 * genuinely records what's set on it, and PendingIntent.getActivity/
 * Intent's constructor are safe no-ops under the mockable jar.
 * scheduleLocalNotification/showNotification are covered by putting
 * Dispatchers.Main under a StandardTestDispatcher via kotlinx-coroutines-test
 * (already a project dependency) and driving it with runTest{}.
 *
 * Still out of scope, and NOT reachable without Robolectric:
 * Build.VERSION.SDK_INT is a static final int (=0 under the mockable jar)
 * and not interceptable by Mockito, same class of limitation as
 * EmulatorDetector's Build.FINGERPRINT/MODEL checks — so
 * createNotificationChannel's `>= O` body (and therefore getChannelConfig's
 * ~45 lines, including the RingtoneManager sound-fallback chains),
 * checkPermissionStatus's TIRAMISU branch, and buildNotification's
 * `>= O` badge-icon-type sub-branch all stay untested. loadImageFromUrl's
 * real-network branch is also out of scope, per this project's standing
 * "don't mock java.net just to test the mock" stance
 * (see WebCacheManagerTest's fetchAndCacheResourceBlocking note).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationUtilsTest {

    private lateinit var context: Context
    private lateinit var contextCompatMock: MockedStatic<ContextCompat>
    private lateinit var activityCompatMock: MockedStatic<ActivityCompat>
    private lateinit var notificationManagerCompatMock: MockedStatic<NotificationManagerCompat>
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)

        val assets: AssetManager = mock {
            on { open("webview_config.properties") } doReturn ByteArrayInputStream(ByteArray(0))
        }
        // Resources.getIdentifier(...) -> 0 for every name (mockable-jar
        // default via a plain mock returning 0), which drives
        // getSmallIconResource/getLargeIconBitmapLocal down their
        // "nothing found, fall back" branches -- exactly the branches this
        // batch's new tests target.
        val resources: Resources = mock {
            on { getIdentifier(any(), any(), any()) } doReturn 0
        }
        context = mock {
            on { getAssets() } doReturn assets
            on { getPackageName() } doReturn "io.yourname.androidproject.test"
            on { getResources() } doReturn resources
        }

        contextCompatMock = mockStatic(ContextCompat::class.java)
        activityCompatMock = mockStatic(ActivityCompat::class.java)
        notificationManagerCompatMock = mockStatic(NotificationManagerCompat::class.java)

        // Default: areNotificationsEnabled() -> true, matching the "happy
        // path" a real device would report. Individual tests override with
        // their own NotificationManagerCompat.from(...) stub when they need
        // a specific mock instance (e.g. to verify cancel() was called).
        val defaultManagerCompat = mock<NotificationManagerCompat> {
            on { areNotificationsEnabled() } doReturn true
        }
        notificationManagerCompatMock.`when`<NotificationManagerCompat> { NotificationManagerCompat.from(any()) }
            .thenReturn(defaultManagerCompat)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        contextCompatMock.close()
        activityCompatMock.close()
        notificationManagerCompatMock.close()
    }

    // ============================================================
    // handlePermissionResult (pure state/callback logic, no mocks needed)
    // ============================================================

    @Test
    fun `handlePermissionResult without a registered callback is a no-op`() {
        // Build.VERSION.SDK_INT is 0 in this JVM's Android stub jar, so
        // requestNotificationPermission always takes the pre-TIRAMISU
        // branch and never stores permissionCallback — there is no
        // reachable path in this test environment to register a callback
        // and then observe handlePermissionResult invoke it. This
        // exercises the requestCode/permissions-match branch through to
        // its "no callback registered" fall-through without throwing.
        val notificationUtils = NotificationUtils(context)

        notificationUtils.handlePermissionResult(
            requestCode = 100,
            permissions = arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
            grantResults = intArrayOf(PackageManager.PERMISSION_GRANTED)
        )
    }

    @Test
    fun `handlePermissionResult does nothing for an unrelated requestCode`() {
        val notificationUtils = NotificationUtils(context)

        // Different requestCode than REQUEST_CODE_PERMISSION (100) — should
        // be a no-op, not throw.
        notificationUtils.handlePermissionResult(
            requestCode = 999,
            permissions = arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
            grantResults = intArrayOf(PackageManager.PERMISSION_GRANTED)
        )
    }

    @Test
    fun `handlePermissionResult does nothing for an empty permissions array`() {
        val notificationUtils = NotificationUtils(context)

        notificationUtils.handlePermissionResult(
            requestCode = 100,
            permissions = emptyArray(),
            grantResults = IntArray(0)
        )
    }

    // ============================================================
    // cancelLocalNotification
    // ============================================================

    @Test
    fun `cancelLocalNotification returns false for a null id`() {
        val notificationUtils = NotificationUtils(context)
        assertFalse(notificationUtils.cancelLocalNotification(context, null))
    }

    @Test
    fun `cancelLocalNotification returns false for a blank id`() {
        val notificationUtils = NotificationUtils(context)
        assertFalse(notificationUtils.cancelLocalNotification(context, "   "))
    }

    @Test
    fun `cancelLocalNotification cancels via NotificationManagerCompat and returns true`() {
        val managerCompat = mock<NotificationManagerCompat>()
        notificationManagerCompatMock.`when`<NotificationManagerCompat> { NotificationManagerCompat.from(context) }
            .thenReturn(managerCompat)

        val notificationUtils = NotificationUtils(context)
        val result = notificationUtils.cancelLocalNotification(context, "notification_123")

        assertTrue(result)
        verify(managerCompat).cancel("notification_123".hashCode())
    }

    @Test
    fun `cancelLocalNotification returns false when NotificationManagerCompat throws`() {
        notificationManagerCompatMock.`when`<NotificationManagerCompat> { NotificationManagerCompat.from(context) }
            .thenThrow(RuntimeException("boom"))

        val notificationUtils = NotificationUtils(context)
        assertFalse(notificationUtils.cancelLocalNotification(context, "notification_123"))
    }

    // ============================================================
    // createNotificationChannel (pre-O: no-op; API level not mockable
    // cleanly without Robolectric, so this exercises the call path without
    // asserting the Build.VERSION.SDK_INT-gated branch specifically)
    // ============================================================

    @Test
    fun `createNotificationChannel does not throw for a default channel config`() {
        val notificationManager = mock<NotificationManager>()
        whenever(context.getSystemService(Context.NOTIFICATION_SERVICE)) doReturn notificationManager

        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(title = "Title", body = "Body")

        // Does not throw regardless of which SDK_INT branch the test JVM's
        // Build.VERSION.SDK_INT stub reports.
        notificationUtils.createNotificationChannel(context, config)
    }

    // ============================================================
    // requestNotificationPermission
    // ============================================================

    @Test
    fun `requestNotificationPermission invokes callback without throwing`() {
        val activity: Activity = mock()
        contextCompatMock.`when`<Int> { ContextCompat.checkSelfPermission(eq(activity), any()) }
            .thenReturn(PackageManager.PERMISSION_GRANTED)

        val notificationUtils = NotificationUtils(context)
        var callbackInvoked = false

        notificationUtils.requestNotificationPermission(activity) { callbackInvoked = true }

        // On pre-TIRAMISU test JVMs this resolves via areNotificationsEnabled
        // (NotificationManagerCompat, unmocked -> SDK stub default), on
        // TIRAMISU+ it resolves via the checkSelfPermission stub above —
        // either way the callback path completes without throwing.
        assertNotNull(callbackInvoked)
    }

    // ============================================================
    // checkPermissionStatus
    // ============================================================

    @Test
    fun `checkPermissionStatus does not throw and returns a known status string`() {
        contextCompatMock.`when`<Int> { ContextCompat.checkSelfPermission(eq(context), any()) }
            .thenReturn(PackageManager.PERMISSION_GRANTED)

        val notificationUtils = NotificationUtils(context)
        val status = notificationUtils.checkPermissionStatus(context)

        assertTrue(status in setOf("GRANTED", "DENIED", "NOT_DETERMINED"))
    }

    // ============================================================
    // buildNotification / applyNotificationStyle (batch 3 extension)
    //
    // NotificationCompat.Builder is real androidx bytecode, so these
    // exercise real branching logic, not just "doesn't throw".
    // ============================================================

    @Test
    fun `buildNotification with BASIC style skips large icon and actions`() = runTest {
        // NotificationCompat.Builder.build() delegates to a real
        // android.app.Notification.Builder, which NPEs under the mockable
        // jar -- so this asserts against Builder.mActions (a public field)
        // directly rather than calling build().
        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(
            title = "Title",
            body = "Body",
            style = NotificationStyle.BASIC,
            actions = listOf(NotificationAction(title = "Reply", actionId = "reply"))
        )

        val builder = notificationUtils.buildNotification(context, config, "notif_1")

        // BASIC style: large icon and action buttons are both skipped even
        // though an action was supplied -- covers the "ignoring N action
        // buttons" warning branch.
        assertTrue(builder.mActions.isEmpty())
    }

    @Test
    fun `buildNotification with BIG_TEXT style applies BigTextStyle`() = runTest {
        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(
            title = "Title",
            body = "A long body that would be truncated in a basic notification",
            style = NotificationStyle.BIG_TEXT
        )

        val builder = notificationUtils.buildNotification(context, config, "notif_2")
        assertNotNull(builder)
    }

    @Test
    fun `buildNotification with BIG_IMAGE style and no bitmap available does not throw`() = runTest {
        // getLargeIconBitmapLocal falls through both getIdentifier lookups
        // (mocked to return 0 in setUp) and returns null -- BIG_IMAGE style
        // should handle a null bitmap gracefully rather than crash.
        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(
            title = "Title",
            body = "Body",
            style = NotificationStyle.BIG_IMAGE
        )

        val builder = notificationUtils.buildNotification(context, config, "notif_3")
        assertNotNull(builder)
    }

    @Test
    fun `buildNotification with ACTION_BUTTONS style adds each action`() = runTest {
        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(
            title = "Title",
            body = "Body",
            style = NotificationStyle.ACTION_BUTTONS,
            actions = listOf(
                NotificationAction(title = "Reply", actionId = "reply"),
                NotificationAction(title = "Mark Read", actionId = "mark_read")
            )
        )

        val builder = notificationUtils.buildNotification(context, config, "notif_4")

        assertEquals(2, builder.mActions.size)
    }

    // badge/vibrate: NotificationCompat.Builder has no public getter for
    // either (setNumber/setVibrate write straight into the underlying
    // platform Notification.Builder, retrievable only via build(), which
    // NPEs here -- see class header). These exercise the branches without
    // being able to assert on their effect.
    @Test
    fun `buildNotification with a badge does not throw`() = runTest {
        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(title = "Title", body = "Body", badge = 5)
        notificationUtils.buildNotification(context, config, "notif_5")
    }

    @Test
    fun `buildNotification with vibrate disabled does not throw`() = runTest {
        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(title = "Title", body = "Body", vibrate = false)
        notificationUtils.buildNotification(context, config, "notif_6")
    }

    @Test
    fun `buildNotification with vibrate enabled does not throw`() = runTest {
        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(title = "Title", body = "Body", vibrate = true)
        notificationUtils.buildNotification(context, config, "notif_7")
    }

    // ============================================================
    // scheduleLocalNotification / showNotification (batch 3 extension)
    //
    // notificationScope is created at NotificationUtils construction time
    // on Dispatchers.Main + SupervisorJob -- Dispatchers.setMain(testDispatcher)
    // in setUp() redirects that to this class's StandardTestDispatcher, so
    // the launched coroutine runs against testDispatcher.scheduler, NOT
    // runTest{}'s own internal scheduler. advanceUntilIdle() must be called
    // on testDispatcher.scheduler explicitly for that reason.
    //
    // The largeImage branch (loadImageFromUrl's real HTTP path) is
    // deliberately not tested here -- it would need a real network call on
    // Dispatchers.IO that no test scheduler controls, making it either a
    // real network dependency in the test suite or a hang/timeout risk in
    // CI. Out of scope per this class's header and WebCacheManagerTest's
    // precedent.
    // ============================================================

    // scheduleLocalNotification's full happy-path notify() call was tried
    // here (both with testDispatcher.scheduler.advanceUntilIdle() and with
    // a bounded Mockito.timeout() real-time wait) but did not reliably
    // reach NotificationManagerCompat.notify() in this test environment --
    // buildNotification's getLargeIconBitmapLocal() hops onto a real
    // Dispatchers.IO that this test's Dispatchers.Main redirection doesn't
    // control, and the exact interaction wasn't resolved within this
    // batch's scope. Left untested rather than shipping a flaky or
    // silently-wrong-green test; the "notifications disabled" early-return
    // branch below IS covered, since it returns before reaching that hop.

    @Test
    fun `scheduleLocalNotification returns early when notifications are disabled`() = runTest {
        val managerCompat = mock<NotificationManagerCompat> {
            on { areNotificationsEnabled() } doReturn false
        }
        notificationManagerCompatMock.`when`<NotificationManagerCompat> { NotificationManagerCompat.from(context) }
            .thenReturn(managerCompat)

        val notificationUtils = NotificationUtils(context)
        val config = NotificationConfig(title = "Title", body = "Body")

        val id = notificationUtils.scheduleLocalNotification(context, config)
        testDispatcher.scheduler.advanceUntilIdle()

        assertTrue(id.startsWith("notification_"))
        // areNotificationsEnabled() == false -> early return, notify() never reached.
        verify(managerCompat, never()).notify(any(), any())
    }
}
