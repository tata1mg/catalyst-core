package io.yourname.androidproject.utils

import android.content.Context
import android.util.DisplayMetrics
import android.view.Display
import android.view.WindowManager
import io.yourname.androidproject.security.SecurityCheckManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import java.util.Properties

/**
 * Unit tests for DeviceInfoUtils (Android coverage batch 4), previously
 * entirely untested (0/~40 lines).
 *
 * NOTE: A root-package `io.yourname.androidproject.DeviceInfoUtilsTest`
 * already existed before this batch (contract/shape assertions only, no
 * mocking, doesn't call getDeviceInfo() at all). Per this task's package-
 * matching rule, this new file lives in the `.utils` package alongside its
 * source and is a distinct class from the old one -- both compile and run
 * side by side. The old file is left untouched ("test files only, don't
 * touch other files") but is a candidate for a follow-up cleanup/removal
 * since this file supersedes it with real mock-driven coverage.
 *
 * Empirically confirmed facts this suite relies on (see task history):
 * - Under this project's mockable android.jar
 *   (testOptions.unitTests.isReturnDefaultValues = true), Build.VERSION.SDK_INT
 *   is 0, so getDisplayMetrics() always takes the pre-R (`else`) branch:
 *   windowManager.defaultDisplay.getMetrics(displayMetrics). The R+
 *   WindowMetrics branch (Build.VERSION.SDK_INT >= R) is unreachable under
 *   this test setup and is NOT covered here -- Build.VERSION.SDK_INT is a
 *   static final int and not mockable (project-wide rule #1).
 * - Build.MODEL / Build.MANUFACTURER are null under the mockable jar
 *   (also unmockable per rule #1). Verified empirically (see a throwaway
 *   org.json.JSONObject script) that `JSONObject.put(key, null)` does NOT
 *   store a null value -- it OMITS the key entirely (`has(key)` returns
 *   false afterwards). So this suite does NOT assert presence/absence of
 *   "model"/"manufacturer" one way or the other as a stable contract --
 *   only that the fields that DON'T depend on Build.* (screenWidth/
 *   screenHeight/screenDensity/appInfo/security) are correct.
 * - SecurityCheckManager.getLatestSecurityResults(context) is exercised
 *   with a plain mocked Context (no SharedPreferences stubbing): its
 *   internal try/catch absorbs the NPE from an unstubbed
 *   getSharedPreferences() call and returns null, so getDeviceInfo() takes
 *   the "security pending" branch. This mirrors
 *   SecurityCheckManagerTest's own "returns null when nothing has been
 *   saved yet" / "throws" coverage, so SecurityCheckManager's internals
 *   are not re-tested here -- only that DeviceInfoUtils wires the pending
 *   fallback correctly.
 */
class DeviceInfoUtilsTest {

    private fun mockContext(widthPx: Int, heightPx: Int, density: Float): Context {
        val display = mock<Display> {
            on { getMetrics(any()) } doAnswer { invocation ->
                val dm = invocation.getArgument<DisplayMetrics>(0)
                dm.widthPixels = widthPx
                dm.heightPixels = heightPx
                dm.density = density
                Unit
            }
        }
        val windowManager = mock<WindowManager> {
            on { getDefaultDisplay() } doReturn display
        }
        return mock {
            on { getSystemService(Context.WINDOW_SERVICE) } doReturn windowManager
        }
    }

    // ============================================================
    // Screen dimension fields (via the pre-R WindowManager path)
    // ============================================================

    @Test
    fun `getDeviceInfo populates screen fields from the deprecated defaultDisplay path`() {
        val context = mockContext(widthPx = 1080, heightPx = 2280, density = 2.75f)

        val info = DeviceInfoUtils.getDeviceInfo(context)

        assertEquals(1080, info.getInt("screenWidth"))
        assertEquals(2280, info.getInt("screenHeight"))
        assertEquals(2.75, info.getDouble("screenDensity"), 0.001)
    }

    @Test
    fun `getDeviceInfo always sets platform to android`() {
        val context = mockContext(widthPx = 100, heightPx = 200, density = 1.0f)

        val info = DeviceInfoUtils.getDeviceInfo(context)

        assertEquals("android", info.getString("platform"))
    }

    // ============================================================
    // appInfo (from optional Properties)
    // ============================================================

    @Test
    fun `getDeviceInfo includes appInfo from properties when present`() {
        val context = mockContext(widthPx = 100, heightPx = 200, density = 1.0f)
        val properties = Properties().apply { setProperty("appInfo", "MyApp v1.2.3") }

        val info = DeviceInfoUtils.getDeviceInfo(context, properties)

        assertEquals("MyApp v1.2.3", info.getString("appInfo"))
    }

    @Test
    fun `getDeviceInfo sets appInfo to JSON null when properties is null`() {
        val context = mockContext(widthPx = 100, heightPx = 200, density = 1.0f)

        val info = DeviceInfoUtils.getDeviceInfo(context, null)

        assertTrue(info.has("appInfo"))
        assertTrue(info.isNull("appInfo"))
    }

    @Test
    fun `getDeviceInfo sets appInfo to JSON null when properties lacks the key`() {
        val context = mockContext(widthPx = 100, heightPx = 200, density = 1.0f)
        val properties = Properties().apply { setProperty("unrelated", "value") }

        val info = DeviceInfoUtils.getDeviceInfo(context, properties)

        assertTrue(info.isNull("appInfo"))
    }

    // ============================================================
    // security field
    // ============================================================

    @Test
    fun `getDeviceInfo marks security pending when no results are saved yet`() {
        val context = mockContext(widthPx = 100, heightPx = 200, density = 1.0f)

        // No SharedPreferences stubbing -- SecurityCheckManager.getLatestSecurityResults
        // catches the resulting failure internally and returns null (matches
        // SecurityCheckManagerTest's own "returns null" precedent).
        val info = DeviceInfoUtils.getDeviceInfo(context)

        assertTrue(info.has("security"))
        assertTrue(info.getJSONObject("security").getBoolean("pending"))
    }

    // ============================================================
    // Error path
    // ============================================================

    @Test
    fun `getDeviceInfo returns an error object when getSystemService throws`() {
        val context: Context = mock {
            on { getSystemService(Context.WINDOW_SERVICE) } doAnswer { throw RuntimeException("boom") }
        }

        val info = DeviceInfoUtils.getDeviceInfo(context)

        assertTrue(info.has("error"))
        assertFalse(info.has("screenWidth"))
    }
}
