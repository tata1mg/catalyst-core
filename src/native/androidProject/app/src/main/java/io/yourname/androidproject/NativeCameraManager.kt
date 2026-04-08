package io.yourname.androidproject

import android.graphics.Color
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.webkit.WebView
import android.widget.TextView
import androidx.camera.view.PreviewView
import com.google.mlkit.vision.barcode.common.Barcode
import io.yourname.androidproject.camera.*
import io.yourname.androidproject.utils.BridgeUtils
import org.json.JSONObject

/**
 * Thin facade — wires all camera sub-components and exposes the public API
 * that NativeBridge.kt calls. All logic lives in the camera/ package.
 */
class NativeCameraManager(
    private val activity: MainActivity,
    private val previewView: PreviewView,
    private val webView: WebView,
    private val debugOverlay: View? = null,
    private val debugQrStatus: TextView? = null,
    private val debugBarcodeOverlay: View? = null
) {

    companion object {
        private const val TAG = "NativeCameraManager"
        const val PERMISSION_REQUEST_CODE = CameraSessionManager.PERMISSION_REQUEST_CODE

        // QR overlay colors — change here to update both states
        private const val COLOR_QR_IN_FRAME = "#5500FF00"  // green, semi-transparent
        private const val COLOR_QR_DETECTED  = "#55FF6600"  // orange, semi-transparent
        private const val OVERLAY_HIDE_DELAY_MS = 200L
    }

    private val stateMachine = VideoStreamStateMachine()

    private val zoomController = ZoomController(
        context = activity,
        stateMachine = stateMachine,
        onZoomChanged = { zoomLevel, minZoom, maxZoom ->
            val payload = JSONObject().apply {
                // zoomLevel = raw CameraX zoomRatio (1.0=1x, 2.0=2x)
                put("zoomLevel", Math.round(zoomLevel * 10.0) / 10.0)
                put("minZoom", Math.round(minZoom * 10.0) / 10.0)
                put("maxZoom", Math.round(maxZoom * 10.0) / 10.0)
            }
            BridgeUtils.notifyWebJson(webView, BridgeUtils.WebEvents.ON_ZOOM_CHANGED, payload)
            // Repaint overlay at new zoom level — barcode rect shifts as camera zooms
            if (showQrDetected && overlayVisible) {
                lastBarcodeScreenRect?.let { repaintQrOverlay(it, overlayIsOrange) }
            }
        }
    )

    private val torchController = TorchController(
        onTorchChanged = { enabled ->
            val payload = JSONObject().apply { put("enabled", enabled) }
            BridgeUtils.notifyWebJson(webView, BridgeUtils.WebEvents.ON_TORCH_CHANGED, payload)
        }
    )

    private val barcodeDetector = BarcodeDetector(
        zoomController = zoomController,
        onDetected = { barcode, imgW, imgH -> onBarcodeDetected(barcode, imgW, imgH) }
    )

    private val sessionManager = CameraSessionManager(
        activity = activity,
        previewView = previewView,
        stateMachine = stateMachine,
        zoomController = zoomController,
        torchController = torchController,
        barcodeDetector = barcodeDetector,
        onReady = {
            BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_VIDEO_STREAM_READY)
        },
        onStopped = {
            debugOverlay?.let { activity.runOnUiThread { it.visibility = View.GONE } }
            BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_VIDEO_STREAM_STOPPED)
        },
        onError = { message ->
            BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_CAMERA_ERROR, message)
        }
    )

    private val holdController = HoldController(
        stateMachine = stateMachine,
        barcodeDetector = barcodeDetector
    )

    // Viewfinder state
    private var viewfinderScreenRect: RectF? = null

    // QR detected overlay state
    private var showQrDetected: Boolean = false
    private var overlayIsOrange: Boolean = false       // logical state — set before showQrOverlay
    private var overlayPaintedOrange: Boolean = false  // what color was last painted
    private var overlayVisible: Boolean = false
    private var lastBarcodeScreenRect: RectF? = null
    private val overlayHideHandler = Handler(Looper.getMainLooper())
    private var overlayHideRunnable: Runnable? = null

    init {
        stateMachine.addListener(object : VideoStreamStateListener {
            override fun onStateChanged(prev: VideoStreamState, next: VideoStreamState) {
                // Reset overlay when hold ends (new scan cycle) or stream stops
                if ((prev == VideoStreamState.HOLD && next == VideoStreamState.STREAMING) ||
                    next == VideoStreamState.IDLE || next == VideoStreamState.STOPPING
                ) {
                    hideQrOverlay()
                }
            }
        })
    }

    // ---- Public API (called from NativeBridge) ----

    fun start(facing: String = "back", viewfinderRectJson: JSONObject? = null, zoomOptions: JSONObject? = null, scanFormat: String = "all", fpsMin: Int? = null, fpsMax: Int? = null, showQrDetected: Boolean = false) {
        if (stateMachine.isActive) return

        this.showQrDetected = showQrDetected
        this.overlayIsOrange = false
        this.overlayPaintedOrange = false
        this.overlayVisible = false
        this.lastBarcodeScreenRect = null

        val autoZoom = zoomOptions?.optBoolean("auto", false) ?: false
        val initialZoomPct = zoomOptions?.optDouble("initial", 1.0)?.toFloat() ?: 1.0f

        // Parse viewfinder rect and position debug overlay
        viewfinderRectJson?.let { json ->
            val result = ViewfinderMapper.parseViewfinderRect(json, webView)
            viewfinderScreenRect = result?.first
            result?.second?.let { jsRect -> positionDebugOverlay(jsRect) }
        } ?: run {
            viewfinderScreenRect = null
            Log.w(TAG, "No viewfinderRect — all QR codes will be reported")
        }

        stateMachine.transition(VideoStreamState.STARTING)
        sessionManager.start(
            facing = facing,
            autoZoom = autoZoom,
            initialZoomPct = initialZoomPct,  // now Float multiplier (1.0 = 1x)
            scanFormat = scanFormat,
            fpsMin = fpsMin,
            fpsMax = fpsMax
        )
    }

    fun stop() {
        if (!stateMachine.isActive) return
        holdController.reset()
        stateMachine.transition(VideoStreamState.STOPPING)
        sessionManager.stop()
    }

    fun flip() {
        if (!stateMachine.isActive) return
        holdController.reset()
        stateMachine.transition(VideoStreamState.FLIPPING)
        sessionManager.flip()
    }

    fun setZoom(multiplier: Float) = zoomController.setZoom(multiplier)

    fun setTorch(on: Boolean) = torchController.setTorch(on)

    fun setFps(min: Int?, max: Int?) {
        if (!stateMachine.isActive) return
        sessionManager.setFps(min, max)
    }

    fun onTouchEvent(event: MotionEvent): Boolean = zoomController.onTouchEvent(event)

    fun onPermissionResult(granted: Boolean) = sessionManager.onPermissionResult(granted)

    fun cleanup() = sessionManager.cleanup()

    // ---- Detection handler ----

    private fun onBarcodeDetected(barcode: Barcode, imageWidth: Int, imageHeight: Int) {
        val value = barcode.rawValue ?: return

        // Hold gate — defensive check for in-flight frames
        if (stateMachine.state == VideoStreamState.HOLD) {
            Log.d(TAG, "onBarcodeDetected — in hold, skipping: $value")
            return
        }

        // QR overlay — show green immediately (QR in frame), update position each frame
        val barcodeScreenRect = barcode.boundingBox?.let { box ->
            ViewfinderMapper.mapBarcodeToScreen(
                box.left, box.top, box.right, box.bottom,
                imageWidth, imageHeight,
                previewView.width.toFloat(), previewView.height.toFloat()
            )
        }
        if (showQrDetected && barcodeScreenRect != null) {
            showQrOverlay(barcodeScreenRect, orange = overlayIsOrange)
        }

        // Viewfinder region filter
        val regionRect = viewfinderScreenRect
        if (regionRect != null) {
            if (barcodeScreenRect != null) {
                if (!regionRect.contains(barcodeScreenRect)) {
                    updateDebugQrStatus(inside = false)
                    return
                }
                updateDebugQrStatus(inside = true)
            }
        }

        // Same-value dedup — enter hold either way
        if (!holdController.isNewValue(value)) {
            Log.d(TAG, "onBarcodeDetected — same value, suppressing: $value")
            holdController.startHold()
            return
        }

        // New value confirmed — flip overlay to orange before firing event
        if (showQrDetected && barcodeScreenRect != null) {
            overlayIsOrange = true
            showQrOverlay(barcodeScreenRect, orange = true)
        }

        holdController.startHold()

        val payload = JSONObject().apply {
            put("value", value)
            put("format", BarcodeDetector.formatName(barcode.format))
        }
        BridgeUtils.notifyWebJson(webView, BridgeUtils.WebEvents.ON_QR_DETECTED, payload)
        Log.d(TAG, "QR detected (new): $value")
    }

    // ---- QR detected overlay ----

    /**
     * Called on every ML Kit frame that has a barcode.
     * If overlay is already visible: only reschedule the hide — no layout/color update (prevents flicker).
     * If overlay is not visible: position it, set color, show it.
     * lastBarcodeScreenRect is always updated so zoom repaints use the freshest position.
     */
    private fun showQrOverlay(screenRect: RectF, orange: Boolean) {
        lastBarcodeScreenRect = screenRect

        // Reschedule hide regardless
        overlayHideRunnable?.let { overlayHideHandler.removeCallbacks(it) }
        val hideRunnable = Runnable { hideQrOverlayOnUiThread() }
        overlayHideRunnable = hideRunnable
        overlayHideHandler.postDelayed(hideRunnable, OVERLAY_HIDE_DELAY_MS)

        if (overlayVisible && orange == overlayPaintedOrange) return  // already painted at correct color — skip to prevent flicker

        repaintQrOverlay(screenRect, orange)
    }

    /**
     * Force-reposition and repaint the overlay. Called on first show and on zoom change.
     * screenRect is in PreviewView/RelativeLayout space — no offset adjustment needed.
     */
    private fun repaintQrOverlay(screenRect: RectF, orange: Boolean) {
        val color = Color.parseColor(if (orange) COLOR_QR_DETECTED else COLOR_QR_IN_FRAME)
        overlayVisible = true
        overlayPaintedOrange = orange
        activity.runOnUiThread {
            debugBarcodeOverlay?.let { overlay ->
                val lp = overlay.layoutParams as android.widget.RelativeLayout.LayoutParams
                lp.leftMargin = screenRect.left.toInt()
                lp.topMargin  = screenRect.top.toInt()
                lp.width      = screenRect.width().toInt()
                lp.height     = screenRect.height().toInt()
                overlay.layoutParams = lp
                overlay.setBackgroundColor(color)
                overlay.visibility = View.VISIBLE
            }
        }
    }

    private fun hideQrOverlay() {
        overlayHideRunnable?.let { overlayHideHandler.removeCallbacks(it) }
        overlayHideRunnable = null
        overlayIsOrange = false
        overlayPaintedOrange = false
        lastBarcodeScreenRect = null
        hideQrOverlayOnUiThread()
    }

    private fun hideQrOverlayOnUiThread() {
        overlayVisible = false
        activity.runOnUiThread {
            debugBarcodeOverlay?.visibility = View.GONE
        }
    }

    // ---- Debug overlay helpers ----

    private fun positionDebugOverlay(jsRect: RectF) {
        activity.runOnUiThread {
            debugOverlay?.let { overlay ->
                val lp = overlay.layoutParams as android.widget.RelativeLayout.LayoutParams
                lp.leftMargin = jsRect.left.toInt()
                lp.topMargin = jsRect.top.toInt()
                lp.width = jsRect.width().toInt()
                lp.height = jsRect.height().toInt()
                overlay.layoutParams = lp
                overlay.setBackgroundResource(R.drawable.debug_viewfinder_border)
                overlay.visibility = View.VISIBLE
            }
        }
    }

    private fun updateDebugQrStatus(inside: Boolean) {
        activity.runOnUiThread {
            if (inside) {
                debugQrStatus?.setTextColor(Color.parseColor("#34C759"))
                debugQrStatus?.text = "⬤ QR inside"
            } else {
                debugQrStatus?.setTextColor(Color.parseColor("#FF3B30"))
                debugQrStatus?.text = "⬤ QR outside"
            }
        }
    }
}
