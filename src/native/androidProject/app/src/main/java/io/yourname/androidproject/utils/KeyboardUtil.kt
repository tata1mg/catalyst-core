package io.yourname.androidproject.utils

import android.app.Activity
import android.graphics.Rect
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

    fun initialize() {
        val rootView = activity.findViewById<ViewGroup>(android.R.id.content)
        
        webViewContainer.post {
            originalHeight = webViewContainer.height
        }
        
        listener = ViewTreeObserver.OnGlobalLayoutListener {
            val rect = Rect()
            rootView.getWindowVisibleDisplayFrame(rect)
            val keyboardHeight = activity.resources.displayMetrics.heightPixels - rect.height()
            
            if (keyboardHeight > 200) {
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
