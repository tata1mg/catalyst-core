package io.yourname.androidproject.utils

import android.content.res.Configuration
import android.content.res.Resources
import android.view.View
import android.view.Window
import androidx.activity.ComponentActivity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mockito.kotlin.atLeastOnce
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import java.util.Properties

/**
 * Unit tests for EdgeToEdgeUtils, the edge-to-edge window setup shared by
 * SplashActivity and MainActivity (previously 0/15 lines covered).
 *
 * `apply` hands off to androidx.activity's `enableEdgeToEdge`, which reads
 * the window's decor view and its resources to decide the icon colors, so
 * the activity mock is wired with just that chain. Under the mockable
 * android.jar (isReturnDefaultValues = true) Build.VERSION.SDK_INT is 0, so
 * androidx takes its base (no-op) implementation: these tests assert that
 * every `edgeToEdge.statusBarStyle` value, including an unknown one, reaches
 * the window without throwing.
 */
class EdgeToEdgeUtilsTest {

    private fun properties(vararg pairs: Pair<String, String>) = Properties().apply {
        pairs.forEach { (k, v) -> setProperty(k, v) }
    }

    private fun mockActivity(): ComponentActivity {
        val configuration = Configuration()
        val resources = mock<Resources> { on { getConfiguration() } doReturn configuration }
        val decorView = mock<View> { on { getResources() } doReturn resources }
        val window = mock<Window> { on { getDecorView() } doReturn decorView }
        return mock { on { getWindow() } doReturn window }
    }

    @Test
    fun isEnabled_defaultsToFalseWhenKeyMissing() {
        assertFalse(EdgeToEdgeUtils.isEnabled(Properties()))
    }

    @Test
    fun isEnabled_trueIsCaseInsensitive() {
        assertTrue(EdgeToEdgeUtils.isEnabled(properties("edgeToEdge.enabled" to "true")))
        assertTrue(EdgeToEdgeUtils.isEnabled(properties("edgeToEdge.enabled" to "TRUE")))
    }

    @Test
    fun isEnabled_anyOtherValueIsFalse() {
        assertFalse(EdgeToEdgeUtils.isEnabled(properties("edgeToEdge.enabled" to "false")))
        assertFalse(EdgeToEdgeUtils.isEnabled(properties("edgeToEdge.enabled" to "yes")))
    }

    @Test
    fun apply_autoIsTheDefaultStyle() {
        val activity = mockActivity()
        EdgeToEdgeUtils.apply(activity, Properties())
        verify(activity, atLeastOnce()).window
    }

    @Test
    fun apply_darkContentStyle() {
        val activity = mockActivity()
        EdgeToEdgeUtils.apply(activity, properties("edgeToEdge.statusBarStyle" to "dark-content"))
        verify(activity, atLeastOnce()).window
    }

    @Test
    fun apply_lightContentStyle() {
        val activity = mockActivity()
        EdgeToEdgeUtils.apply(activity, properties("edgeToEdge.statusBarStyle" to "light-content"))
        verify(activity, atLeastOnce()).window
    }

    @Test
    fun apply_unknownStyleFallsBackToAuto() {
        val activity = mockActivity()
        EdgeToEdgeUtils.apply(activity, properties("edgeToEdge.statusBarStyle" to "sparkly"))
        verify(activity, atLeastOnce()).window
    }
}
