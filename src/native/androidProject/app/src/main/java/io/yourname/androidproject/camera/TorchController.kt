package io.yourname.androidproject.camera

import android.util.Log
import androidx.camera.core.Camera

/**
 * Manages torch (flashlight) state.
 * Guards against front-camera torch calls.
 * Fires ON_TORCH_CHANGED via [onTorchChanged] callback.
 */
class TorchController(
    private val onTorchChanged: (enabled: Boolean) -> Unit
) {

    private val TAG = "TorchController"

    private var camera: Camera? = null
    private var currentFacing: String = "back"

    fun attachCamera(cam: Camera, facing: String) {
        camera = cam
        currentFacing = facing
    }

    fun detachCamera() {
        camera = null
    }

    fun setTorch(on: Boolean) {
        val cam = camera ?: run {
            Log.w(TAG, "setTorch($on) — camera is null, skipping")
            return
        }
        if (currentFacing == "front") {
            Log.w(TAG, "setTorch($on) — front camera has no torch, ignoring")
            return
        }
        Log.d(TAG, "setTorch($on)")
        cam.cameraControl.enableTorch(on)
        onTorchChanged(on)
    }

    /** Called after every bindCamera — torch always resets to off on session start. */
    fun notifyReset() {
        onTorchChanged(false)
        Log.d(TAG, "Torch reset to off (new session)")
    }
}
