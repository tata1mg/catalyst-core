package io.yourname.androidproject.utils

import android.graphics.Color
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import io.yourname.androidproject.BuildConfig
import java.util.Properties

/**
 * Edge-to-edge window setup shared by SplashActivity and MainActivity.
 *
 * Reads `edgeToEdge.statusBarStyle` from webview_config.properties:
 * - "auto" (default): androidx defaults, icons follow the system theme
 * - "dark-content": dark icons, for light page backgrounds
 * - "light-content": light icons, for dark page backgrounds
 */
object EdgeToEdgeUtils {

    private const val TAG = "EdgeToEdgeUtils"

    // Copies of androidx.activity's internal DefaultLightScrim / DefaultDarkScrim (activity 1.8.0)
    private val DEFAULT_LIGHT_SCRIM = Color.argb(0xe6, 0xFF, 0xFF, 0xFF)
    private val DEFAULT_DARK_SCRIM = Color.argb(0x80, 0x1b, 0x1b, 0x1b)

    fun isEnabled(properties: Properties): Boolean =
        properties.getProperty("edgeToEdge.enabled", "false").equals("true", ignoreCase = true)

    /**
     * Draws the activity behind the system bars and applies the configured bar style.
     * Must be called before setContentView.
     */
    fun apply(activity: ComponentActivity, properties: Properties) {
        when (val style = properties.getProperty("edgeToEdge.statusBarStyle", "auto")) {
            "auto" -> activity.enableEdgeToEdge()
            "dark-content" -> activity.enableEdgeToEdge(
                statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
                navigationBarStyle = SystemBarStyle.light(DEFAULT_LIGHT_SCRIM, DEFAULT_DARK_SCRIM)
            )
            "light-content" -> activity.enableEdgeToEdge(
                statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
                navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
            )
            else -> {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "⚠️ Unknown edgeToEdge.statusBarStyle '$style', falling back to auto")
                }
                activity.enableEdgeToEdge()
            }
        }
    }
}
