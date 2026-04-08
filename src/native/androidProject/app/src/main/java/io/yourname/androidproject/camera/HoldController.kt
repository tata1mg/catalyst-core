package io.yourname.androidproject.camera

import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Manages the QR hold state — after each detection, results are suppressed for HOLD_DURATION_MS
 * to prevent the same QR from firing repeatedly and to let auto-zoom relax.
 *
 * Uses a suppress flag in BarcodeDetector instead of unbind/rebind — camera pipeline
 * stays bound the whole time, so there is no flicker.
 */
class HoldController(
    private val stateMachine: VideoStreamStateMachine,
    private val barcodeDetector: BarcodeDetector
) {

    private val TAG = "HoldController"
    private val HOLD_DURATION_MS = 200L

    private val handler = Handler(Looper.getMainLooper())
    private var resumeRunnable: Runnable? = null

    var lastDetectedValue: String? = null
        private set

    /**
     * Call after a new QR value is confirmed. Suppresses results for HOLD_DURATION_MS,
     * then re-enables and transitions back to STREAMING.
     */
    fun startHold() {
        if (!stateMachine.transition(VideoStreamState.HOLD)) return

        barcodeDetector.suppressResults = true
        Log.d(TAG, "Hold started — results suppressed for ${HOLD_DURATION_MS}ms")

        val runnable = Runnable {
            if (!stateMachine.state.isActive) return@Runnable
            barcodeDetector.suppressResults = false
            stateMachine.transition(VideoStreamState.STREAMING)
            Log.d(TAG, "Hold ended — results resumed")
        }
        resumeRunnable = runnable
        handler.postDelayed(runnable, HOLD_DURATION_MS)
    }

    /**
     * Call on stop() or flip() to cancel any pending hold and clear detection memory.
     */
    fun reset() {
        resumeRunnable?.let { handler.removeCallbacks(it) }
        resumeRunnable = null
        barcodeDetector.suppressResults = false
        lastDetectedValue = null
        Log.d(TAG, "Hold state reset")
    }

    /**
     * Returns true if this value is new (not a repeat of the last detected value).
     * Also updates lastDetectedValue if it is new.
     */
    fun isNewValue(value: String): Boolean {
        if (value == lastDetectedValue) return false
        lastDetectedValue = value
        return true
    }
}
