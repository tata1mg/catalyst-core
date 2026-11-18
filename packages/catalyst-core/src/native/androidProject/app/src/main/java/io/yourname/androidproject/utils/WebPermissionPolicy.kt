package io.yourname.androidproject.utils

import android.webkit.PermissionRequest

/**
 * Which of the resources a web page asked for (getUserMedia and friends) the WebView may grant.
 *
 * A resource is granted only when the app itself already holds the matching Android permission; the page gets that
 * permission through the bridge first (requestCameraPermission / requestMicrophonePermission). Anything else the page
 * asks for, such as location or protected media, stays denied.
 */
object WebPermissionPolicy {

    fun grantable(requested: Array<String>?, hasCamera: Boolean, hasMicrophone: Boolean): Array<String> {
        if (requested == null) return emptyArray()
        return requested.filter { resource ->
            when (resource) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> hasCamera
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> hasMicrophone
                else -> false
            }
        }.toTypedArray()
    }
}
