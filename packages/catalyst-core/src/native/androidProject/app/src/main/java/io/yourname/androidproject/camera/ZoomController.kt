package io.yourname.androidproject.camera

import android.animation.ValueAnimator
import android.util.Log
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.animation.DecelerateInterpolator
import androidx.camera.core.Camera
import android.content.Context

/**
 * Handles all zoom operations:
 *  - setZoom(multiplier: Float) via bridge — 1.0 = 1x, 2.0 = 2x
 *  - pinch-to-zoom via ScaleGestureDetector
 *  - auto-zoom suggestion callback (wired from BarcodeDetector)
 *
 * Fires ON_ZOOM_CHANGED via [onZoomChanged] callback after each zoom change.
 * Payload: zoomLevel (Float multiplier, e.g. 1.5), minZoom, maxZoom.
 */
class ZoomController(
    context: Context,
    private val stateMachine: VideoStreamStateMachine,
    private val onZoomChanged: (zoomLevel: Float, minZoom: Float, maxZoom: Float) -> Unit
) {

    private val TAG = "ZoomController"

    private var camera: Camera? = null

    // Smooth auto-zoom state
    private var zoomAnimator: ValueAnimator? = null
    private var lastSuggestedRatio: Float = -1f
    private var consecutiveSuggestionCount: Int = 0
    private val SUGGESTION_CONFIRM_FRAMES = 2      // frames before committing to a zoom target
    private val SUGGESTION_TOLERANCE = 0.1f        // ratio delta considered "same target"
    private val ZOOM_ANIMATION_DURATION_MS = 300L

    private val scaleGestureDetector = ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                if (!stateMachine.isActive) return true
                val cam = camera ?: return true
                val zoomState = cam.cameraInfo.zoomState.value ?: return true
                val newRatio = (zoomState.zoomRatio * detector.scaleFactor)
                    .coerceIn(zoomState.minZoomRatio, zoomState.maxZoomRatio)
                cam.cameraControl.setZoomRatio(newRatio)
                onZoomChanged(newRatio, zoomState.minZoomRatio, zoomState.maxZoomRatio)
                return true
            }
        }
    )

    fun attachCamera(cam: Camera) {
        camera = cam
    }

    fun detachCamera() {
        cancelZoomAnimation()
        camera = null
    }

    fun onTouchEvent(event: MotionEvent): Boolean {
        return if (stateMachine.isActive) scaleGestureDetector.onTouchEvent(event) else false
    }

    /** Called from bridge: multiplier e.g. 1.0=1x, 2.0=2x */
    fun setZoom(multiplier: Float) {
        Log.d(TAG, "setZoom(${multiplier}x) called")
        applyZoomMultiplier(multiplier)
    }

    fun applyZoomMultiplier(multiplier: Float) {
        val cam = camera ?: run {
            Log.w(TAG, "applyZoomMultiplier(${multiplier}x) — camera is null, skipping")
            return
        }
        val zoomState = cam.cameraInfo.zoomState.value ?: run {
            Log.w(TAG, "applyZoomMultiplier(${multiplier}x) — zoomState is null, skipping")
            return
        }
        val min = zoomState.minZoomRatio
        val max = zoomState.maxZoomRatio
        val ratio = multiplier.coerceIn(min, max)
        Log.d(TAG, "applyZoomMultiplier(${multiplier}x) → ratio=$ratio (min=$min max=$max)")
        cam.cameraControl.setZoomRatio(ratio)
        onZoomChanged(ratio, min, max)
    }

    /**
     * Auto-zoom suggestion from ML Kit ZoomSuggestionOptions.
     * Zoom-only-up guard: never apply a suggestion that would zoom out.
     * Debounce: only commit after SUGGESTION_CONFIRM_FRAMES consecutive frames
     * with the same target (within SUGGESTION_TOLERANCE).
     * Animation: smoothly interpolates from current ratio to target over ZOOM_ANIMATION_DURATION_MS.
     */
    fun onAutoZoomSuggestion(suggestedRatio: Float): Boolean {
        val cam = camera ?: return false
        val zoomState = cam.cameraInfo.zoomState.value ?: return false
        val clamped = suggestedRatio.coerceIn(zoomState.minZoomRatio, zoomState.maxZoomRatio)

        // Zoom-only-up guard
        if (clamped <= zoomState.zoomRatio) {
            Log.d(TAG, "auto-zoom suggestion=$suggestedRatio ignored — would zoom out")
            consecutiveSuggestionCount = 0
            lastSuggestedRatio = -1f
            return false
        }

        // Debounce: count consecutive frames pointing at the same target
        if (Math.abs(clamped - lastSuggestedRatio) <= SUGGESTION_TOLERANCE) {
            consecutiveSuggestionCount++
        } else {
            consecutiveSuggestionCount = 1
            lastSuggestedRatio = clamped
        }

        if (consecutiveSuggestionCount < SUGGESTION_CONFIRM_FRAMES) {
            Log.d(TAG, "auto-zoom debounce: $consecutiveSuggestionCount/$SUGGESTION_CONFIRM_FRAMES for target=$clamped")
            return false
        }

        // Confirmed — reset counters and animate
        consecutiveSuggestionCount = 0
        lastSuggestedRatio = -1f

        val fromRatio = zoomState.zoomRatio
        val minZoom = zoomState.minZoomRatio
        val maxZoom = zoomState.maxZoomRatio
        Log.d(TAG, "auto-zoom: animating $fromRatio → $clamped")

        zoomAnimator?.cancel()
        zoomAnimator = ValueAnimator.ofFloat(fromRatio, clamped).apply {
            duration = ZOOM_ANIMATION_DURATION_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener { animator ->
                val ratio = animator.animatedValue as Float
                cam.cameraControl.setZoomRatio(ratio)
                onZoomChanged(ratio, minZoom, maxZoom)
            }
            start()
        }
        return true
    }

    fun cancelZoomAnimation() {
        zoomAnimator?.cancel()
        zoomAnimator = null
        consecutiveSuggestionCount = 0
        lastSuggestedRatio = -1f
    }

    fun currentMaxZoomRatio(): Float {
        return camera?.cameraInfo?.zoomState?.value?.maxZoomRatio ?: 8.0f
    }
}
