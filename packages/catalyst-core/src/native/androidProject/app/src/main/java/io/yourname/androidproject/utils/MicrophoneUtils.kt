package io.yourname.androidproject.utils

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.webkit.WebView
import androidx.core.content.ContextCompat

/**
 * Microphone permission handling for the native bridge.
 *
 * The WebView records through getUserMedia({ audio }); it only honours that request while the app itself holds
 * RECORD_AUDIO (see CustomWebview.onPermissionRequest). The page asks for the permission through the bridge
 * (requestMicrophonePermission) before it starts recording, the same way it does for the camera.
 */
object MicrophoneUtils {

    private const val TAG = "MicrophoneUtils"
    const val MICROPHONE_PERMISSION = Manifest.permission.RECORD_AUDIO

    /** True when the app holds RECORD_AUDIO. */
    fun hasMicrophonePermission(activity: Activity): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            MICROPHONE_PERMISSION
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** "GRANTED" or "DENIED", the values the web layer's PERMISSION_STATUS uses. */
    fun getPermissionStatus(activity: Activity): String {
        return if (hasMicrophonePermission(activity)) "GRANTED" else "DENIED"
    }

    /** Tells the page how a permission request ended. */
    fun handlePermissionResult(webView: WebView, isGranted: Boolean) {
        if (isGranted) {
            BridgeUtils.logDebug(TAG, "Microphone permission granted")
        } else {
            BridgeUtils.logError(TAG, "Microphone permission denied")
        }
        BridgeUtils.notifyWeb(
            webView,
            BridgeUtils.WebEvents.MICROPHONE_PERMISSION_STATUS,
            if (isGranted) "GRANTED" else "DENIED"
        )
    }
}
