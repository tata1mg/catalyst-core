package io.yourname.androidproject.design

import android.content.Context
import android.content.res.Configuration
import androidx.annotation.ColorInt

/**
 * Global design tokens for the application.
 * Follows Material Design 3 principles with support for light/dark themes.
 *
 * All spacing follows 8dp grid system.
 * Color system supports dynamic theming based on system configuration.
 */
object DesignTokens {

    // ============================================================
    // COLORS - Light Theme
    // ============================================================
    object LightColors {
        // Surface colors
        @ColorInt const val SURFACE = 0xFFFFFFFF.toInt()           // Pure white
        @ColorInt const val SURFACE_VARIANT = 0xFFF5F5F5.toInt()   // Light gray background

        // Error colors (for alerts, warnings)
        @ColorInt const val ERROR = 0xFFB3261E.toInt()             // Material error red
        @ColorInt const val ERROR_CONTAINER = 0xFFF9DEDC.toInt()   // Light red background
        @ColorInt const val ON_ERROR = 0xFFFFFFFF.toInt()          // White text on error
        @ColorInt const val ON_ERROR_CONTAINER = 0xFF410E0B.toInt() // Dark red text

        // Text colors
        @ColorInt const val ON_SURFACE = 0xFF1C1B1F.toInt()        // Primary text (near black)
        @ColorInt const val ON_SURFACE_VARIANT = 0xFF49454F.toInt() // Secondary text (gray)
        @ColorInt const val OUTLINE = 0xFF79747E.toInt()           // Dividers, borders

        // Accent colors
        @ColorInt const val PRIMARY = 0xFF6750A4.toInt()           // Material purple
        @ColorInt const val ON_PRIMARY = 0xFFFFFFFF.toInt()        // White text on primary
        @ColorInt const val PRIMARY_CONTAINER = 0xFFEADDFF.toInt() // Light purple background
        @ColorInt const val ON_PRIMARY_CONTAINER = 0xFF21005D.toInt() // Dark purple text

        // Secondary colors
        @ColorInt const val SECONDARY = 0xFF625B71.toInt()         // Material gray-purple
        @ColorInt const val ON_SECONDARY = 0xFFFFFFFF.toInt()      // White text on secondary
        @ColorInt const val SECONDARY_CONTAINER = 0xFFE8DEF8.toInt() // Light secondary background
        @ColorInt const val ON_SECONDARY_CONTAINER = 0xFF1D192B.toInt() // Dark text
    }

    // ============================================================
    // COLORS - Dark Theme
    // ============================================================
    object DarkColors {
        // Surface colors
        @ColorInt const val SURFACE = 0xFF1C1B1F.toInt()           // Dark surface
        @ColorInt const val SURFACE_VARIANT = 0xFF2B2930.toInt()   // Darker variant

        // Error colors (for alerts, warnings)
        @ColorInt const val ERROR = 0xFFF2B8B5.toInt()             // Light red for dark mode
        @ColorInt const val ERROR_CONTAINER = 0xFF8C1D18.toInt()   // Dark red background
        @ColorInt const val ON_ERROR = 0xFF601410.toInt()          // Dark text on light error
        @ColorInt const val ON_ERROR_CONTAINER = 0xFFF2B8B5.toInt() // Light text on dark error

        // Text colors
        @ColorInt const val ON_SURFACE = 0xFFE6E1E5.toInt()        // Light text
        @ColorInt const val ON_SURFACE_VARIANT = 0xFFCAC4D0.toInt() // Secondary light text
        @ColorInt const val OUTLINE = 0xFF938F99.toInt()           // Light dividers, borders

        // Accent colors
        @ColorInt const val PRIMARY = 0xFFD0BCFF.toInt()           // Light purple for dark mode
        @ColorInt const val ON_PRIMARY = 0xFF381E72.toInt()        // Dark text on light primary
        @ColorInt const val PRIMARY_CONTAINER = 0xFF4F378B.toInt() // Dark purple background
        @ColorInt const val ON_PRIMARY_CONTAINER = 0xFFEADDFF.toInt() // Light text

        // Secondary colors
        @ColorInt const val SECONDARY = 0xFFCCC2DC.toInt()         // Light gray-purple for dark
        @ColorInt const val ON_SECONDARY = 0xFF332D41.toInt()      // Dark text on light secondary
        @ColorInt const val SECONDARY_CONTAINER = 0xFF4A4458.toInt() // Dark secondary background
        @ColorInt const val ON_SECONDARY_CONTAINER = 0xFFE8DEF8.toInt() // Light text
    }

    // ============================================================
    // SPACING - Following 8dp Grid System
    // ============================================================
    object Spacing {
        const val SPACE_XXS = 4   // 4dp - Minimal spacing
        const val SPACE_XS = 8    // 8dp - Tight spacing
        const val SPACE_SM = 12   // 12dp - Small spacing
        const val SPACE_MD = 16   // 16dp - Medium spacing (default)
        const val SPACE_LG = 24   // 24dp - Large spacing
        const val SPACE_XL = 32   // 32dp - Extra large spacing
        const val SPACE_XXL = 48  // 48dp - Maximum spacing
    }

    // ============================================================
    // DIMENSIONS
    // ============================================================
    object Dimensions {
        // Corner radius
        const val CORNER_RADIUS_SM = 8   // Small corners (buttons, chips)
        const val CORNER_RADIUS_MD = 16  // Medium corners (cards)
        const val CORNER_RADIUS_LG = 24  // Large corners (bottom sheet top)
        const val CORNER_RADIUS_XL = 28  // Extra large (full rounded)

        // Icon sizes
        const val ICON_SIZE_SM = 24      // Small icons
        const val ICON_SIZE_MD = 48      // Medium icons
        const val ICON_SIZE_LG = 64      // Large icons (hero icon)
        const val ICON_SIZE_XL = 96      // Extra large icons

        // Minimum touch target (Material Design)
        const val MIN_TOUCH_TARGET = 48  // 48dp minimum for accessibility

        // Elevation (for shadows/depth)
        const val ELEVATION_NONE = 0f
        const val ELEVATION_SM = 2f      // Small elevation
        const val ELEVATION_MD = 4f      // Medium elevation
        const val ELEVATION_LG = 8f      // Large elevation
    }

    // ============================================================
    // TYPOGRAPHY
    // ============================================================
    object Typography {
        // Text sizes (SP - scalable pixels)
        const val TEXT_SIZE_DISPLAY = 32f    // Large headlines
        const val TEXT_SIZE_HEADLINE = 24f   // Section headlines
        const val TEXT_SIZE_TITLE = 20f      // Card titles
        const val TEXT_SIZE_BODY_LG = 16f    // Large body text
        const val TEXT_SIZE_BODY = 14f       // Default body text
        const val TEXT_SIZE_LABEL = 12f      // Small labels, captions

        // Line height multipliers
        const val LINE_HEIGHT_TIGHT = 1.2f   // Tight line height
        const val LINE_HEIGHT_NORMAL = 1.5f  // Normal line height
        const val LINE_HEIGHT_RELAXED = 1.7f // Relaxed line height

        // Font weights (Android Typeface)
        const val FONT_WEIGHT_NORMAL = android.graphics.Typeface.NORMAL
        const val FONT_WEIGHT_MEDIUM = android.graphics.Typeface.BOLD  // Medium approximation
        const val FONT_WEIGHT_BOLD = android.graphics.Typeface.BOLD
    }

    // ============================================================
    // ANIMATION DURATIONS (milliseconds)
    // ============================================================
    object Animation {
        const val DURATION_SHORT = 200L      // Quick transitions
        const val DURATION_MEDIUM = 300L     // Standard transitions
        const val DURATION_LONG = 500L       // Emphasized transitions
        const val DURATION_EXTRA_LONG = 700L // Hero transitions
    }

    // ============================================================
    // OPACITY/ALPHA VALUES
    // ============================================================
    object Opacity {
        const val DISABLED = 0.38f           // Disabled state
        const val MEDIUM = 0.60f             // Medium emphasis
        const val HIGH = 0.87f               // High emphasis
        const val FULL = 1.0f                // Full opacity
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    /**
     * Check if the device is in dark mode.
     *
     * @param context Android context
     * @return true if dark mode is enabled
     */
    fun isDarkMode(context: Context): Boolean {
        val nightModeFlags = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return nightModeFlags == Configuration.UI_MODE_NIGHT_YES
    }

    /**
     * Get surface color based on current theme.
     */
    @ColorInt
    fun getSurfaceColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.SURFACE else LightColors.SURFACE
    }

    /**
     * Get surface variant color based on current theme.
     */
    @ColorInt
    fun getSurfaceVariantColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.SURFACE_VARIANT else LightColors.SURFACE_VARIANT
    }

    /**
     * Get error color based on current theme.
     */
    @ColorInt
    fun getErrorColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ERROR else LightColors.ERROR
    }

    /**
     * Get error container color based on current theme.
     */
    @ColorInt
    fun getErrorContainerColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ERROR_CONTAINER else LightColors.ERROR_CONTAINER
    }

    /**
     * Get on-error color (text on error background) based on current theme.
     */
    @ColorInt
    fun getOnErrorColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ON_ERROR else LightColors.ON_ERROR
    }

    /**
     * Get on-error-container color based on current theme.
     */
    @ColorInt
    fun getOnErrorContainerColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ON_ERROR_CONTAINER else LightColors.ON_ERROR_CONTAINER
    }

    /**
     * Get primary text color based on current theme.
     */
    @ColorInt
    fun getOnSurfaceColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ON_SURFACE else LightColors.ON_SURFACE
    }

    /**
     * Get secondary text color based on current theme.
     */
    @ColorInt
    fun getOnSurfaceVariantColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ON_SURFACE_VARIANT else LightColors.ON_SURFACE_VARIANT
    }

    /**
     * Get outline color (dividers, borders) based on current theme.
     */
    @ColorInt
    fun getOutlineColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.OUTLINE else LightColors.OUTLINE
    }

    /**
     * Get primary color based on current theme.
     */
    @ColorInt
    fun getPrimaryColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.PRIMARY else LightColors.PRIMARY
    }

    /**
     * Get on-primary color (text on primary background) based on current theme.
     */
    @ColorInt
    fun getOnPrimaryColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ON_PRIMARY else LightColors.ON_PRIMARY
    }

    /**
     * Get primary container color based on current theme.
     */
    @ColorInt
    fun getPrimaryContainerColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.PRIMARY_CONTAINER else LightColors.PRIMARY_CONTAINER
    }

    /**
     * Get on-primary-container color based on current theme.
     */
    @ColorInt
    fun getOnPrimaryContainerColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ON_PRIMARY_CONTAINER else LightColors.ON_PRIMARY_CONTAINER
    }

    /**
     * Get secondary color based on current theme.
     */
    @ColorInt
    fun getSecondaryColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.SECONDARY else LightColors.SECONDARY
    }

    /**
     * Get on-secondary color based on current theme.
     */
    @ColorInt
    fun getOnSecondaryColor(context: Context): Int {
        return if (isDarkMode(context)) DarkColors.ON_SECONDARY else LightColors.ON_SECONDARY
    }

    /**
     * Convert DP to pixels.
     *
     * @param context Android context
     * @param dp Value in density-independent pixels
     * @return Value in pixels
     */
    fun dpToPx(context: Context, dp: Int): Int {
        return (dp * context.resources.displayMetrics.density).toInt()
    }

    /**
     * Convert SP to pixels (for text sizes).
     *
     * @param context Android context
     * @param sp Value in scalable pixels
     * @return Value in pixels
     */
    fun spToPx(context: Context, sp: Float): Int {
        return (sp * context.resources.displayMetrics.scaledDensity).toInt()
    }
}
