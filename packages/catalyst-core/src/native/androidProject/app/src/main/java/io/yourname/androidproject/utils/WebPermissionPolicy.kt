package io.yourname.androidproject.utils

import android.webkit.PermissionRequest

/**
 * Which of the resources a web page asked for (getUserMedia and friends) the WebView may grant.
 *
 * A resource is granted only when the app itself already holds the matching Android permission; the page gets that
 * permission through the bridge first (requestCameraPermission / requestMicrophonePermission). Anything else the page
 * asks for, such as location or protected media, stays denied.
 *
 * The app-wide permission is not enough on its own: the page asking must be the app's own content, otherwise any page
 * the WebView happens to load could record the user once the app holds the microphone. See [isTrustedOrigin].
 */
object WebPermissionPolicy {

    fun grantable(requested: Array<String>?, hasCamera: Boolean, hasMicrophone: Boolean, originTrusted: Boolean): Array<String> {
        if (requested == null || !originTrusted) return emptyArray()
        return requested.filter { resource ->
            when (resource) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> hasCamera
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> hasMicrophone
                else -> false
            }
        }.toTypedArray()
    }

    /**
     * Whether a page at [origin] may use camera or microphone: only the app's own page ([appUrl]), by exact scheme, host
     * and port. The access-control whitelist is deliberately not consulted: its rules match substrings and prefixes, so
     * "https://allowed.example.evil.example" would pass a rule for "https://allowed.example".
     */
    fun isTrustedOrigin(origin: String?, appUrl: String?): Boolean {
        val requesting = originOf(origin) ?: return false
        val app = originOf(appUrl) ?: return false
        return requesting == app
    }

    /** scheme://host:port in lower case with the default port filled in, or null when [url] has no web origin. */
    internal fun originOf(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return try {
            val uri = java.net.URI(url.trim())
            val scheme = uri.scheme?.lowercase() ?: return null
            if (scheme != "http" && scheme != "https") return null
            val host = uri.host?.lowercase() ?: return null
            val port = if (uri.port != -1) uri.port else if (scheme == "https") 443 else 80
            "$scheme://$host:$port"
        } catch (e: java.net.URISyntaxException) {
            null
        }
    }
}
