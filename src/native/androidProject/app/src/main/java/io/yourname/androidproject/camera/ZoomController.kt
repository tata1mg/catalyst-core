package io.yourname.androidproject.camera

import android.util.Log
import android.view.MotionEvent
import android.view.ScaleGestureDetector
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
     */
    fun onAutoZoomSuggestion(suggestedRatio: Float): Boolean {
        val cam = camera ?: return false
        val zoomState = cam.cameraInfo.zoomState.value ?: return false
        val clamped = suggestedRatio.coerceIn(zoomState.minZoomRatio, zoomState.maxZoomRatio)
        if (clamped <= zoomState.zoomRatio) {
            Log.d(TAG, "auto-zoom suggestion=$suggestedRatio ignored — would zoom out")
            return false
        }
        Log.d(TAG, "auto-zoom: $suggestedRatio → $clamped")
        cam.cameraControl.setZoomRatio(clamped)
        onZoomChanged(clamped, zoomState.minZoomRatio, zoomState.maxZoomRatio)
        return true
    }

    fun currentMaxZoomRatio(): Float {
        return camera?.cameraInfo?.zoomState?.value?.maxZoomRatio ?: 8.0f
    }
}
