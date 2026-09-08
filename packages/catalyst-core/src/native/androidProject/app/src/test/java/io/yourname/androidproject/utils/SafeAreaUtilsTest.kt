package io.yourname.androidproject.utils

import androidx.core.graphics.Insets
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertEquals
import org.junit.Test
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever

/**
 * Unit tests for SafeAreaUtils.fromWindowInsets (Android coverage batch
 * 3), previously entirely untested (0/17 lines).
 *
 * androidx.core.graphics.Insets and WindowInsetsCompat are androidx
 * library classes (not android.jar SDK stubs) -- Insets.of(l,t,r,b) is a
 * real static factory that actually assigns its fields, so value
 * assertions on the returned SafeAreaInsets are meaningful here (unlike
 * android.graphics.RectF in ViewfinderMapperTest, which IS an android.jar
 * stub whose constructor never runs).
 *
 * Deliberately out of scope, per the task: getSafeAreaInsets(window,
 * rootView, edgeToEdgeEnabled) is a thin passthrough that calls
 * ViewCompat.getRootWindowInsets(...) -- a static androidx method --
 * before delegating to fromWindowInsets. Testing it would require
 * mockStatic(ViewCompat), which the task explicitly says to skip; only
 * fromWindowInsets is covered.
 */
class SafeAreaUtilsTest {

    private fun windowInsetsCompatWith(systemBars: Insets, cutout: Insets = Insets.NONE): WindowInsetsCompat {
        return mock {
            on { getInsets(WindowInsetsCompat.Type.systemBars()) } doReturn systemBars
            on { getInsets(WindowInsetsCompat.Type.displayCutout()) } doReturn cutout
        }
    }

    // ============================================================
    // Null input
    // ============================================================

    @Test
    fun `fromWindowInsets returns ZERO when insets is null`() {
        val result = SafeAreaUtils.fromWindowInsets(null, edgeToEdgeEnabled = true)
        assertEquals(SafeAreaInsets.ZERO, result)
    }

    // ============================================================
    // edge-to-edge disabled -- system bars only
    // ============================================================

    @Test
    fun `fromWindowInsets with edge-to-edge disabled returns system bar insets directly`() {
        val systemBars = Insets.of(10, 20, 30, 40)
        val windowInsets = windowInsetsCompatWith(systemBars)

        val result = SafeAreaUtils.fromWindowInsets(windowInsets, edgeToEdgeEnabled = false)

        assertEquals(SafeAreaInsets(top = 20, right = 30, bottom = 40, left = 10), result)
    }

    @Test
    fun `fromWindowInsets with edge-to-edge disabled ignores the display cutout`() {
        val systemBars = Insets.of(10, 20, 30, 40)
        val cutout = Insets.of(100, 100, 100, 100)
        val windowInsets = windowInsetsCompatWith(systemBars, cutout)

        val result = SafeAreaUtils.fromWindowInsets(windowInsets, edgeToEdgeEnabled = false)

        assertEquals(SafeAreaInsets(top = 20, right = 30, bottom = 40, left = 10), result)
    }

    // ============================================================
    // edge-to-edge enabled -- max(system bars, cutout) per edge
    // ============================================================

    @Test
    fun `fromWindowInsets with edge-to-edge enabled takes the max of system bars and cutout per edge`() {
        val systemBars = Insets.of(10, 50, 30, 5)
        val cutout = Insets.of(0, 20, 60, 15)
        val windowInsets = windowInsetsCompatWith(systemBars, cutout)

        val result = SafeAreaUtils.fromWindowInsets(windowInsets, edgeToEdgeEnabled = true)

        // left: max(10, 0)=10, top: max(50, 20)=50, right: max(30, 60)=60, bottom: max(5, 15)=15
        assertEquals(SafeAreaInsets(top = 50, right = 60, bottom = 15, left = 10), result)
    }

    @Test
    fun `fromWindowInsets with edge-to-edge enabled and a zero cutout equals the system bars`() {
        val systemBars = Insets.of(10, 20, 30, 40)
        val windowInsets = windowInsetsCompatWith(systemBars, Insets.NONE)

        val result = SafeAreaUtils.fromWindowInsets(windowInsets, edgeToEdgeEnabled = true)

        assertEquals(SafeAreaInsets(top = 20, right = 30, bottom = 40, left = 10), result)
    }

    // ============================================================
    // SafeAreaInsets.toMap()
    // ============================================================

    @Test
    fun `toMap exposes all four edges by name`() {
        val insets = SafeAreaInsets(top = 1, right = 2, bottom = 3, left = 4)
        assertEquals(mapOf("top" to 1, "right" to 2, "bottom" to 3, "left" to 4), insets.toMap())
    }
}
