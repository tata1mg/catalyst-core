package io.yourname.androidproject.camera

/**
 * State machine for the video stream lifecycle.
 *
 * Valid transitions:
 *   IDLE       → STARTING   (start() called, permission check begins)
 *   STARTING   → STREAMING  (camera bound successfully)
 *   STARTING   → IDLE       (permission denied or bind failure)
 *   STREAMING  → HOLD       (QR detected — analyzer unbound for hold duration)
 *   HOLD       → STREAMING  (hold expired — analyzer rebound)
 *   STREAMING  → FLIPPING   (flip() called)
 *   FLIPPING   → STREAMING  (rebind complete after flip)
 *   STREAMING  → STOPPING   (stop() called)
 *   FLIPPING   → STOPPING   (stop() called mid-flip)
 *   HOLD       → STOPPING   (stop() called during hold)
 *   STOPPING   → IDLE       (unbind complete)
 */
enum class VideoStreamState {
    IDLE,
    STARTING,
    STREAMING,
    HOLD,
    FLIPPING,
    STOPPING;

    fun canTransitionTo(next: VideoStreamState): Boolean = when (this) {
        IDLE      -> next == STARTING
        STARTING  -> next == STREAMING || next == IDLE
        STREAMING -> next == HOLD || next == FLIPPING || next == STOPPING
        HOLD      -> next == STREAMING || next == STOPPING
        FLIPPING  -> next == STREAMING || next == STOPPING
        STOPPING  -> next == IDLE
    }

    val isActive: Boolean get() = this == STREAMING || this == HOLD || this == FLIPPING
}

interface VideoStreamStateListener {
    fun onStateChanged(prev: VideoStreamState, next: VideoStreamState)
}
