package io.yourname.androidproject.utils

import android.view.View
import android.view.Window
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.ceil
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
     * Computes safe area insets from window insets, in CSS px.
     * CSS px equal dp here: the WebView has no wide-viewport scaling, so
     * devicePixelRatio == density and px / density gives CSS px.
     * - Edge-to-edge disabled: Returns ZERO (the system already insets the WebView, iOS parity)
     * - Edge-to-edge enabled: Returns ceil(max(system bars ignoring visibility, cutout) / density) per edge
     */
    fun fromWindowInsets(insets: WindowInsetsCompat?, edgeToEdgeEnabled: Boolean, density: Float): SafeAreaInsets {
        if (insets == null || !edgeToEdgeEnabled) return SafeAreaInsets.ZERO

        // Ignore visibility: the IME window hosts the nav bar, so the visible systemBars
        // bottom grows to the keyboard height while the keyboard is open
        val systemBars = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars())
        val cutoutInsets = insets.getInsets(WindowInsetsCompat.Type.displayCutout())

        return SafeAreaInsets(
            top = toCssPx(max(systemBars.top, cutoutInsets.top), density),
            right = toCssPx(max(systemBars.right, cutoutInsets.right), density),
            bottom = toCssPx(max(systemBars.bottom, cutoutInsets.bottom), density),
            left = toCssPx(max(systemBars.left, cutoutInsets.left), density)
        )
    }

    fun getSafeAreaInsets(window: Window, rootView: View, edgeToEdgeEnabled: Boolean): SafeAreaInsets {
        val windowInsets =
            ViewCompat.getRootWindowInsets(window.decorView) ?: ViewCompat.getRootWindowInsets(rootView)
        return fromWindowInsets(windowInsets, edgeToEdgeEnabled, rootView.resources.displayMetrics.density)
    }

    private fun toCssPx(px: Int, density: Float): Int = max(0, ceil(px / density).toInt())
}
