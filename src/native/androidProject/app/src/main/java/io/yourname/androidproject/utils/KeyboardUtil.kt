package io.yourname.androidproject.utils

import android.app.Activity
import android.graphics.Rect
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.constraintlayout.widget.ConstraintLayout

class KeyboardUtil(
    private val activity: Activity,
    private val webViewContainer: View
) {
    private var originalHeight: Int = 0
    private var listener: ViewTreeObserver.OnGlobalLayoutListener? = null
    
    // Keyboard detection threshold in dp - commonly used values are 120-150dp
    private val keyboardThresholdDp = 120f
    
    // Calculate minimum keyboard height in pixels based on device density
    private val keyboardThresholdPx: Int by lazy {
        dpToPx(keyboardThresholdDp)
    }
    
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
            if (keyboardHeight > effectiveThreshold) {
                // Keyboard visible - resize
                val params = webViewContainer.layoutParams as ConstraintLayout.LayoutParams
                params.height = originalHeight - keyboardHeight
                webViewContainer.layoutParams = params
            } else {
                // Keyboard hidden - restore
                val params = webViewContainer.layoutParams as ConstraintLayout.LayoutParams
                params.height = originalHeight
                webViewContainer.layoutParams = params
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
}
