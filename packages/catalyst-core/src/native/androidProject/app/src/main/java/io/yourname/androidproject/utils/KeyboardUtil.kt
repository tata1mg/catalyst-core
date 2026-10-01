package io.yourname.androidproject.utils

import android.app.Activity
import android.graphics.Rect
import android.os.SystemClock
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebView
import androidx.constraintlayout.widget.ConstraintLayout
import org.json.JSONObject

class KeyboardUtil(
    private val activity: Activity,
    private val webViewContainer: View,
    private val webView: WebView? = null,
) {
    private var originalHeight: Int = 0
    private var listener: ViewTreeObserver.OnGlobalLayoutListener? = null

    // Keyboard detection threshold in dp - commonly used values are 120-150dp
    private val keyboardThresholdDp = 120f

    // Calculate minimum keyboard height in pixels based on device density
    private val keyboardThresholdPx: Int by lazy {
        dpToPx(keyboardThresholdDp)
    }

    // Track keyboard state to avoid spamming events on every layout pass
    private var keyboardVisible = false

    /**
     * Convert density-independent pixels to pixels
     */
    private fun dpToPx(dp: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp,
            activity.resources.displayMetrics
        ).toInt()
    }

    /**
     * Convert pixels to density-independent pixels
     */
    private fun pxToDp(px: Int): Float {
        return px / activity.resources.displayMetrics.density
    }

    fun initialize() {
        val rootView = activity.findViewById<ViewGroup>(android.R.id.content)

        webViewContainer.post {
            originalHeight = webViewContainer.height
        }
        listener = ViewTreeObserver.OnGlobalLayoutListener {
            val rect = Rect()
            rootView.getWindowVisibleDisplayFrame(rect)
            val screenHeight = activity.resources.displayMetrics.heightPixels
            val visibleHeight = rect.height()
            val keyboardHeight = screenHeight - visibleHeight

            // Use density-independent threshold and consider screen size
            // Also add a minimum percentage of screen height as additional validation
            val minScreenPercentage = (screenHeight * 0.15).toInt() // 15% of screen height
            val effectiveThreshold = maxOf(keyboardThresholdPx, minScreenPercentage)
            val isNowVisible = keyboardHeight > effectiveThreshold

            if (isNowVisible) {
                // Keyboard visible - resize
                val params = webViewContainer.layoutParams as ConstraintLayout.LayoutParams
                params.height = originalHeight - keyboardHeight
                webViewContainer.layoutParams = params

                if (!keyboardVisible) {
                    keyboardVisible = true
                    emitKeyboardEvent("keyboard-show", keyboardHeight)
                }
            } else {
                // Keyboard hidden - restore
                val params = webViewContainer.layoutParams as ConstraintLayout.LayoutParams
                params.height = originalHeight
                webViewContainer.layoutParams = params

                if (keyboardVisible) {
                    keyboardVisible = false
                    emitKeyboardEvent("keyboard-hide", 0)
                }
            }
        }
        rootView.viewTreeObserver.addOnGlobalLayoutListener(listener)
    }

    fun cleanup() {
        listener?.let {
            val rootView = activity.findViewById<ViewGroup>(android.R.id.content)
            rootView.viewTreeObserver.removeOnGlobalLayoutListener(it)
        }
    }

    // ─── Perf telemetry ──────────────────────────────────────────────────────

    /**
     * Emit keyboard show/hide event to WebPerfCollector.
     * Uses SystemClock.elapsedRealtime() so the timestamp is alignable with
     * native Perfetto traces via window.__NATIVE_TIME_OFFSET.
     */
    private fun emitKeyboardEvent(type: String, keyboardHeight: Int) {
        val wv = webView ?: return
        try {
            val payload = JSONObject().apply {
                put("type", type)
                put("nativeTime", SystemClock.elapsedRealtime())
                put("keyboardHeight", keyboardHeight)
            }
            BridgeUtils.emitPerfEvent(wv, payload)
        } catch (e: Exception) {
            // Non-critical — swallow silently
        }
    }
}
