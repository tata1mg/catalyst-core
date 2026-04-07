package io.yourname.androidproject.camera

import android.util.Log

class VideoStreamStateMachine {

    private val TAG = "VideoStreamStateMachine"

    @Volatile
    var state: VideoStreamState = VideoStreamState.IDLE
        private set

    private val listeners = mutableListOf<VideoStreamStateListener>()

    fun addListener(listener: VideoStreamStateListener) {
        listeners.add(listener)
    }

    fun transition(next: VideoStreamState): Boolean {
        val prev = state
        if (!prev.canTransitionTo(next)) {
            Log.w(TAG, "Invalid transition: $prev → $next, ignoring")
            return false
        }
        state = next
        Log.d(TAG, "State: $prev → $next")
        listeners.forEach { it.onStateChanged(prev, next) }
        return true
    }

    val isActive: Boolean get() = state.isActive
}
