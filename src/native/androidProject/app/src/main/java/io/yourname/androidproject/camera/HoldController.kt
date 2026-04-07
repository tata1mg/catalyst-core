package io.yourname.androidproject.camera

import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Manages the QR hold state — after each detection, analysis is paused for HOLD_DURATION_MS
 * to prevent the same QR from firing repeatedly and to let auto-zoom relax.
 *
 * Talks to the state machine for STREAMING ↔ HOLD transitions.
 * Delegates actual analyzer unbind/rebind to [AnalyzerController].
 */
class HoldController(
    private val stateMachine: VideoStreamStateMachine,
    private val analyzerController: AnalyzerController
) {

    interface AnalyzerController {
        fun unbindAnalyzer()
        fun rebindAnalyzer()
    }

    private val TAG = "HoldController"
    private val HOLD_DURATION_MS = 500L

    private val handler = Handler(Looper.getMainLooper())
    private var resumeRunnable: Runnable? = null

    var lastDetectedValue: String? = null
        private set

    /**
     * Call after a new QR value is confirmed. Unbinds analyzer for HOLD_DURATION_MS,
     * then rebinds and transitions back to STREAMING.
     */
    fun startHold() {
        if (!stateMachine.transition(VideoStreamState.HOLD)) return

        analyzerController.unbindAnalyzer()
        Log.d(TAG, "Hold started — analyzer unbound for ${HOLD_DURATION_MS}ms")

        val runnable = Runnable {
            if (!stateMachine.state.isActive) return@Runnable
            analyzerController.rebindAnalyzer()
            stateMachine.transition(VideoStreamState.STREAMING)
            Log.d(TAG, "Hold ended — analyzer rebound")
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
