package io.yourname.androidproject.design

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.util.DisplayMetrics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock

/**
 * Unit tests for DesignTokens' Context-dependent helper functions
 * (previously the only uncovered ~18 lines in this file -- the constant
 * objects like Spacing/Dimensions/Typography/Animation/Opacity need no
 * tests, they're plain compile-time constants already fully "covered" by
 * definition/reference).
 *
 * isDarkMode/dpToPx use a real (not mocked) android.content.res.Configuration
 * instance with its public `uiMode` Int field set directly -- Configuration
 * is a plain data-holder class from android.jar whose fields are ordinary
 * public fields (not accessor methods), so field writes work even under
 * the mockable jar's isReturnDefaultValues stubbing (which only affects
 * method bodies/constructors, not direct field access) -- verified
 * empirically here rather than assumed. context.resources and
 * resources.configuration/displayMetrics are mocked via Mockito.
 *
 * All 12 getXxxColor(context) functions share the same isDarkMode(context)
 * branch shape (dark ? DarkColors.X : LightColors.X) -- rather than
 * duplicating a light+dark test per color, isDarkMode/getSurfaceColor are
 * tested for both branches directly, and every other getXxxColor is
 * spot-checked once each (light mode) to cover its line without redundant
 * dark-mode duplication of the same ternary shape.
 */
class DesignTokensTest {

    private fun contextWithNightMode(nightModeFlag: Int): Context {
        val configuration = Configuration().apply { uiMode = nightModeFlag }
        val resources = mock<Resources> {
            on { getConfiguration() } doReturn configuration
        }
        return mock {
            on { getResources() } doReturn resources
        }
    }

    // ============================================================
    // isDarkMode
    // ============================================================

    @Test
    fun `isDarkMode returns true when uiMode signals night mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_YES)
        assertTrue(DesignTokens.isDarkMode(context))
    }

    @Test
    fun `isDarkMode returns false when uiMode signals day mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertFalse(DesignTokens.isDarkMode(context))
    }

    @Test
    fun `isDarkMode returns false when uiMode has no night-mode bits set`() {
        val context = contextWithNightMode(0)
        assertFalse(DesignTokens.isDarkMode(context))
    }

    // ============================================================
    // getSurfaceColor -- both branches, representative of all
    // getXxxColor(context) functions
    // ============================================================

    @Test
    fun `getSurfaceColor returns the dark surface color in dark mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_YES)
        assertEquals(DesignTokens.DarkColors.SURFACE, DesignTokens.getSurfaceColor(context))
    }

    @Test
    fun `getSurfaceColor returns the light surface color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.SURFACE, DesignTokens.getSurfaceColor(context))
    }

    // ============================================================
    // Remaining getXxxColor functions -- one spot-check each (light mode)
    // ============================================================

    @Test
    fun `getSurfaceVariantColor returns the light surface variant color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.SURFACE_VARIANT, DesignTokens.getSurfaceVariantColor(context))
    }

    @Test
    fun `getErrorColor returns the light error color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ERROR, DesignTokens.getErrorColor(context))
    }

    @Test
    fun `getErrorContainerColor returns the light error container color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ERROR_CONTAINER, DesignTokens.getErrorContainerColor(context))
    }

    @Test
    fun `getOnErrorColor returns the light on-error color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ON_ERROR, DesignTokens.getOnErrorColor(context))
    }

    @Test
    fun `getOnErrorContainerColor returns the light on-error-container color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ON_ERROR_CONTAINER, DesignTokens.getOnErrorContainerColor(context))
    }

    @Test
    fun `getOnSurfaceColor returns the light on-surface color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ON_SURFACE, DesignTokens.getOnSurfaceColor(context))
    }

    @Test
    fun `getOnSurfaceVariantColor returns the light on-surface-variant color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ON_SURFACE_VARIANT, DesignTokens.getOnSurfaceVariantColor(context))
    }

    @Test
    fun `getOutlineColor returns the light outline color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.OUTLINE, DesignTokens.getOutlineColor(context))
    }

    @Test
    fun `getPrimaryColor returns the light primary color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.PRIMARY, DesignTokens.getPrimaryColor(context))
    }

    @Test
    fun `getOnPrimaryColor returns the light on-primary color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ON_PRIMARY, DesignTokens.getOnPrimaryColor(context))
    }

    @Test
    fun `getPrimaryContainerColor returns the light primary container color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.PRIMARY_CONTAINER, DesignTokens.getPrimaryContainerColor(context))
    }

    @Test
    fun `getOnPrimaryContainerColor returns the light on-primary-container color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ON_PRIMARY_CONTAINER, DesignTokens.getOnPrimaryContainerColor(context))
    }

    @Test
    fun `getSecondaryColor returns the light secondary color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.SECONDARY, DesignTokens.getSecondaryColor(context))
    }

    @Test
    fun `getOnSecondaryColor returns the light on-secondary color in light mode`() {
        val context = contextWithNightMode(Configuration.UI_MODE_NIGHT_NO)
        assertEquals(DesignTokens.LightColors.ON_SECONDARY, DesignTokens.getOnSecondaryColor(context))
    }

    // ============================================================
    // dpToPx
    // ============================================================

    @Test
    fun `dpToPx multiplies dp by the display density and truncates to Int`() {
        val displayMetrics = DisplayMetrics().apply { density = 2.5f }
        val resources = mock<Resources> {
            on { getDisplayMetrics() } doReturn displayMetrics
        }
        val context = mock<Context> {
            on { getResources() } doReturn resources
        }

        // 16dp * 2.5 density = 40.0 -> 40px
        assertEquals(40, DesignTokens.dpToPx(context, 16))
    }

    @Test
    fun `dpToPx truncates a fractional result toward zero`() {
        val displayMetrics = DisplayMetrics().apply { density = 1.5f }
        val resources = mock<Resources> {
            on { getDisplayMetrics() } doReturn displayMetrics
        }
        val context = mock<Context> {
            on { getResources() } doReturn resources
        }

        // 5dp * 1.5 density = 7.5 -> 7px (Float.toInt() truncates)
        assertEquals(7, DesignTokens.dpToPx(context, 5))
    }
}
