package io.yourname.androidproject

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import io.yourname.androidproject.utils.BridgeUtils

/**
 * Manages native page transitions using a snapshot-overlay pattern.
 *
 * Flow:
 *   startTransition()  — captures a bitmap of the current WebView, places it as an
 *                        ImageView overlay on top of the content, covering the skeleton
 *                        rendered by the router while the new page loads.
 *   commitTransition() — animates the overlay out (slide or fade) to reveal the new page.
 *   cancelTransition() — removes the overlay immediately without animating.
 *
 * Safety timer: a Handler timer fires on the main thread after `timeout` ms if
 *   commitTransition() was never called (JS error/hang). It force-fades the overlay
 *   and fires ON_TRANSITION_TIMEOUT to JS so the hook can reset its state.
 *
 * Thread safety: all public methods must be called on the main thread.
 */
class TransitionManager(
    private val activity: Activity,
    private val webView: WebView
) {
    private val TAG = "TransitionManager"
    private val mainHandler = Handler(Looper.getMainLooper())

    private var overlayView: ImageView? = null
    private var safetyRunnable: Runnable? = null
    private var activeDuration: Int = 300
    private var activeType: String = "slide"
    private var activeDirection: String = "left"

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    fun startTransition(type: String, direction: String, duration: Int, timeout: Int) {
        // Cancel any orphaned transition first
        cancelTransitionInternal(notify = false)

        activeType = type
        activeDirection = direction
        activeDuration = duration

        val snapshot = captureSnapshot() ?: run {
            Log.w(TAG, "startTransition — snapshot failed, transition skipped")
            return
        }

        val overlay = ImageView(activity).apply {
            setImageBitmap(snapshot)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.MATRIX
        }

        val root = activity.window.decorView as ViewGroup
        root.addView(overlay)
        overlayView = overlay

        Log.d(TAG, "startTransition — overlay attached (type=$type direction=$direction duration=${duration}ms timeout=${timeout}ms)")

        // Arm safety timer
        val safety = Runnable {
            Log.w(TAG, "startTransition — safety timeout fired, force-removing overlay")
            cancelTransitionInternal(notify = false)
            BridgeUtils.notifyWebSuccess(webView, BridgeUtils.WebEvents.ON_TRANSITION_TIMEOUT)
        }
        safetyRunnable = safety
        mainHandler.postDelayed(safety, timeout.toLong())
    }

    fun commitTransition() {
        val overlay = overlayView ?: run {
            Log.w(TAG, "commitTransition — no active overlay, ignoring")
            return
        }

        // Disarm safety timer — we're committing normally
        disarmSafetyTimer()

        when (activeType) {
            "fade" -> animateFadeOut(overlay, activeDuration)
            else -> animateSlideOut(overlay, activeDuration, activeDirection)
        }
    }

    fun cancelTransition() {
        cancelTransitionInternal(notify = true)
    }

    fun cleanup() {
        cancelTransitionInternal(notify = false)
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private fun captureSnapshot(): Bitmap? {
        return try {
            val bmp = Bitmap.createBitmap(webView.width, webView.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            webView.draw(canvas)
            bmp
        } catch (e: Exception) {
            Log.e(TAG, "captureSnapshot failed", e)
            null
        }
    }

    private fun animateSlideOut(overlay: ImageView, duration: Int, direction: String) {
        val root = activity.window.decorView as ViewGroup
        val w = root.width.toFloat()
        val h = root.height.toFloat()

        val (endX, endY) = when (direction) {
            "right" -> Pair(-w, 0f)
            "up"    -> Pair(0f, h)
            "down"  -> Pair(0f, -h)
            else    -> Pair(w, 0f)   // "left" — overlay slides out to the right
        }

        ValueAnimator.ofFloat(0f, 1f).apply {
            this.duration = duration.toLong()
            addUpdateListener { anim ->
                val fraction = anim.animatedFraction
                overlay.translationX = endX * fraction
                overlay.translationY = endY * fraction
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    removeOverlay(overlay)
                    BridgeUtils.notifyWebSuccess(webView, BridgeUtils.WebEvents.ON_TRANSITION_COMMITTED)
                }
            })
            start()
        }
    }

    private fun animateFadeOut(overlay: ImageView, duration: Int) {
        ValueAnimator.ofFloat(1f, 0f).apply {
            this.duration = duration.toLong()
            addUpdateListener { anim ->
                overlay.alpha = anim.animatedValue as Float
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    removeOverlay(overlay)
                    BridgeUtils.notifyWebSuccess(webView, BridgeUtils.WebEvents.ON_TRANSITION_COMMITTED)
                }
            })
            start()
        }
    }

    private fun cancelTransitionInternal(notify: Boolean) {
        disarmSafetyTimer()

        overlayView?.let { overlay ->
            removeOverlay(overlay)
            if (notify) {
                BridgeUtils.notifyWebSuccess(webView, BridgeUtils.WebEvents.ON_TRANSITION_CANCELLED)
            }
        }
    }

    private fun removeOverlay(overlay: ImageView) {
        try {
            val root = activity.window.decorView as ViewGroup
            root.removeView(overlay)
        } catch (e: Exception) {
            Log.w(TAG, "removeOverlay — view already detached: ${e.message}")
        }
        if (overlayView === overlay) {
            overlayView = null
        }
        overlay.setImageBitmap(null)
    }

    private fun disarmSafetyTimer() {
        safetyRunnable?.let { mainHandler.removeCallbacks(it) }
        safetyRunnable = null
    }
}
