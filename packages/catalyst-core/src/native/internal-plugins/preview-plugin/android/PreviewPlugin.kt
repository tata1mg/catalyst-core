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

        const val MODE_PREVIEW = "preview"
        const val MODE_DOCS = "docs"
    }

    override fun handle(command: String, data: JSONObject?, bridge: PluginBridgeContext) {
        if (command != COMMAND_OPEN_BROWSER) {
            sendError(bridge, "Unsupported command: $command", "UNSUPPORTED_COMMAND")
            return
        }

        val payload = data ?: JSONObject()
        val url = payload.optString("url").trim()
        val parsedUrl = Uri.parse(url)
        if (url.isEmpty() || !"https".equals(parsedUrl.scheme, ignoreCase = true) || parsedUrl.host.isNullOrBlank()) {
            sendError(bridge, "Preview requires a valid https:// URL", "INVALID_URL")
            return
        }

        val mode = when (val rawMode = payload.optString("mode", MODE_PREVIEW).trim().lowercase()) {
            MODE_PREVIEW, MODE_DOCS -> rawMode
            else -> {
                sendError(bridge, "Unsupported mode: $rawMode", "INVALID_MODE")
                return
            }
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
                putExtra(PreviewActivity.EXTRA_MODE, mode)
                putExtra(PreviewActivity.EXTRA_EDGE_TO_EDGE, payload.optBoolean("edgeToEdge", false))

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
                    put("mode", mode)
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
