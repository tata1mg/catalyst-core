package io.yourname.androidproject.camera

import android.util.Log
import java.util.concurrent.CopyOnWriteArrayList

class VideoStreamStateMachine {

    private val TAG = "VideoStreamStateMachine"

    @Volatile
    var state: VideoStreamState = VideoStreamState.IDLE
        private set

    private val listeners = CopyOnWriteArrayList<VideoStreamStateListener>()

    fun addListener(listener: VideoStreamStateListener) {
        if (!listeners.contains(listener)) listeners.add(listener)
    }

    fun removeListener(listener: VideoStreamStateListener) {
        listeners.remove(listener)
    }

    @Synchronized
    fun transition(next: VideoStreamState): Boolean {
        val prev = state
        if (!prev.canTransitionTo(next)) {
            Log.w(TAG, "Invalid transition: $prev → $next, ignoring")
            return false
        }
        state = next
        Log.d(TAG, "State: $prev → $next")
        // Notify outside the synchronized block to prevent deadlock if a listener
        // calls back into transition() on the same thread.
        val snapshot = listeners.toList()
        return true.also { snapshot.forEach { it.onStateChanged(prev, next) } }
    }

    val isActive: Boolean get() = state.isActive
}
