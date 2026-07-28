package io.yourname.androidproject.plugins.internal.preview

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.webkit.WebViewFeature
import io.yourname.androidproject.plugins.CatalystPlugin
import io.yourname.androidproject.plugins.PluginBridgeContext
import org.json.JSONObject

/**
 * Shared URL policy for the preview surface, used by both the launcher
 * ([PreviewPlugin]) and the per-navigation check in [PreviewActivity] so the
 * two can never drift apart.
 *
 * The rule: `https` is allowed for any host; cleartext `http` is allowed only
 * for private-network hosts, which is what makes dev-server previews
 * (`http://192.168.1.80:5173`) work without weakening anything public.
 */
internal object PreviewUrlPolicy {

    /** True when [url] may be loaded as a top-level preview navigation. */
    fun isAllowedPreviewUrl(url: Uri): Boolean {
        val host = url.host
        if (host.isNullOrBlank()) {
            return false
        }
        return when (url.scheme?.lowercase()) {
            "https" -> true
            "http" -> isPrivateHost(host)
            else -> false
        }
    }

    /**
     * True for hosts that can only live on the local machine or the local
     * network: "localhost", any ".local" mDNS name, IPv4 loopback (127/8),
     * the RFC1918 ranges (10/8, 172.16/12, 192.168/16), and link-local
     * (169.254/16). Any other hostname — including one that merely looks like
     * an address, e.g. "10.0.0.5.evil.com" — is treated as public.
     */
    fun isPrivateHost(rawHost: String): Boolean {
        // A trailing dot is a legal FQDN root; strip it before comparing.
        val host = rawHost.lowercase().removeSuffix(".")
        if (host == "localhost" || host.endsWith(".local")) {
            return true
        }

        val octets = parseIpv4(host) ?: return false
        return when {
            octets[0] == 127 -> true
            octets[0] == 10 -> true
            octets[0] == 172 && octets[1] in 16..31 -> true
            octets[0] == 192 && octets[1] == 168 -> true
            octets[0] == 169 && octets[1] == 254 -> true
            else -> false
        }
    }

    /**
     * Strict dotted-quad parse: exactly four decimal octets in 0..255. Anything
     * looser (hex forms, missing or extra parts, out-of-range values such as
     * "1721.6.0.1") returns null rather than being coerced into an address.
     */
    private fun parseIpv4(host: String): IntArray? {
        val parts = host.split(".")
        if (parts.size != 4) {
            return null
        }
        val octets = IntArray(4)
        for (index in parts.indices) {
            val part = parts[index]
            if (part.isEmpty() || part.length > 3 || !part.all { it in '0'..'9' }) {
                return null
            }
            val value = part.toIntOrNull() ?: return null
            if (value > 255) {
                return null
            }
            octets[index] = value
        }
        return octets
    }
}

/**
 * Launcher for the isolated Preview browser surface.
 *
 * This plugin never hosts preview state itself: it validates the request,
 * checks that WebView storage isolation is available on this device, and
 * starts [PreviewActivity] in its dedicated ':catalyst_preview' process.
 * The trusted Catalyst WebView is left completely untouched.
 */
class PreviewPlugin : CatalystPlugin {
    companion object {
        private const val TAG = "PreviewPlugin"
        private const val COMMAND_OPEN_BROWSER = "openBrowser"
        private const val CALLBACK_OPENED = "onOpened"
        private const val CALLBACK_ERROR = "onError"
    }

    override fun handle(command: String, data: JSONObject?, bridge: PluginBridgeContext) {
        if (command != COMMAND_OPEN_BROWSER) {
            sendError(bridge, "Unsupported command: $command", "UNSUPPORTED_COMMAND")
            return
        }

        val payload = data ?: JSONObject()
        val url = payload.optString("url").trim()
        val parsedUrl = Uri.parse(url)
        if (url.isEmpty() || !PreviewUrlPolicy.isAllowedPreviewUrl(parsedUrl)) {
            sendError(
                bridge,
                "Preview requires an https:// URL (http:// is allowed for local-network addresses)",
                "INVALID_URL"
            )
            return
        }

        if (!isStorageIsolationSupported(bridge)) {
            sendError(
                bridge,
                "Preview requires a newer Android System WebView",
                "PREVIEW_UNSUPPORTED"
            )
            return
        }

        // Note on the localhost framework server: it keeps running during
        // preview. `http://localhost` is a trustworthy origin in Chromium, so
        // mixed-content blocking does NOT stop an HTTPS preview page from
        // reaching it — the guard is the server's unguessable 128-bit session
        // route (files are keyed by random ids). We intentionally do not call
        // stopServer() here: on the current core it permanently cancels the
        // server's singleton cleanup scope, and the Companion serves no files.
        try {
            val intent = Intent(bridge.activity, PreviewActivity::class.java).apply {
                putExtra(PreviewActivity.EXTRA_URL, url)
                // Edge-to-edge by default: real apps draw under the system bars,
                // and an inset page is what makes preview read as "a browser".
                putExtra(PreviewActivity.EXTRA_EDGE_TO_EDGE, payload.optBoolean("edgeToEdge", true))

                val splash = payload.optJSONObject("splash")
                putExtra(PreviewActivity.EXTRA_SPLASH_ENABLED, splash?.optBoolean("enabled", false) ?: false)
                putExtra(
                    PreviewActivity.EXTRA_SPLASH_BACKGROUND_COLOR,
                    splash?.optString("backgroundColor", "#ffffff") ?: "#ffffff"
                )
                putExtra(PreviewActivity.EXTRA_SPLASH_DURATION, splash?.optLong("duration", 1000L) ?: 1000L)
            }
            bridge.activity.startActivity(intent)
            bridge.callback(
                CALLBACK_OPENED,
                JSONObject().apply {
                    put("url", url)
                }
            )
        } catch (error: Exception) {
            Log.e(TAG, "Failed to open preview", error)
            sendError(bridge, error.message ?: "Failed to open preview", "PREVIEW_LAUNCH_FAILED")
        }
    }

    private fun isStorageIsolationSupported(bridge: PluginBridgeContext): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return true
        }
        return try {
            WebViewFeature.isStartupFeatureSupported(
                bridge.context,
                WebViewFeature.STARTUP_FEATURE_SET_DATA_DIRECTORY_SUFFIX
            )
        } catch (error: Exception) {
            Log.w(TAG, "Storage isolation feature check failed: ${error.message}")
            false
        }
    }

    private fun sendError(bridge: PluginBridgeContext, message: String, code: String) {
        bridge.callback(
            CALLBACK_ERROR,
            JSONObject().apply {
                put("message", message)
                put("code", code)
            }
        )
    }
}
