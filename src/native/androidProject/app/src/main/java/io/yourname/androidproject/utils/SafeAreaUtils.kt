package io.yourname.androidproject.utils

import android.view.View
import android.view.Window
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.max

data class SafeAreaInsets(
    val top: Int,
    val right: Int,
    val bottom: Int,
    val left: Int
) {
    fun toMap(): Map<String, Int> = mapOf(
        "top" to top,
        "right" to right,
        "bottom" to bottom,
        "left" to left
    )

    companion object {
        val ZERO = SafeAreaInsets(0, 0, 0, 0)
    }
}

object SafeAreaUtils {
    /**
     * Computes safe area insets from window insets.
     * - Edge-to-edge disabled: Returns system bars only
     * - Edge-to-edge enabled: Returns max(system bars, cutout) per edge
     */
    fun fromWindowInsets(insets: WindowInsetsCompat?, edgeToEdgeEnabled: Boolean): SafeAreaInsets {
        if (insets == null) return SafeAreaInsets.ZERO

        val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())

        if (!edgeToEdgeEnabled) {
            return SafeAreaInsets(
                top = max(0, systemBars.top),
                right = max(0, systemBars.right),
                bottom = max(0, systemBars.bottom),
                left = max(0, systemBars.left)
            )
        }

        val cutoutInsets = insets.getInsets(WindowInsetsCompat.Type.displayCutout())

        return SafeAreaInsets(
            top = max(0, max(systemBars.top, cutoutInsets.top)),
            right = max(0, max(systemBars.right, cutoutInsets.right)),
            bottom = max(0, max(systemBars.bottom, cutoutInsets.bottom)),
            left = max(0, max(systemBars.left, cutoutInsets.left))
        )
    }

    fun getSafeAreaInsets(window: Window, rootView: View, edgeToEdgeEnabled: Boolean): SafeAreaInsets {
        val windowInsets =
            ViewCompat.getRootWindowInsets(window.decorView) ?: ViewCompat.getRootWindowInsets(rootView)
        return fromWindowInsets(windowInsets, edgeToEdgeEnabled)
    }
}
