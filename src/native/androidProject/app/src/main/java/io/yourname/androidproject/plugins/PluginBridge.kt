package io.yourname.androidproject.plugins

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

class PluginBridge(private val webView: WebView) {
    companion object {
        private const val TAG = "PluginBridge"
        private const val ERROR_EVENT = "PLUGIN_BRIDGE_ERROR"
        private const val SYSTEM_PLUGIN_ID = "__bridge__"
    }

    private val pluginIdToClassName = GeneratedPluginIndex.pluginIdToClassName
    private val pluginToCommands = GeneratedPluginIndex.pluginToCommands
    private val pluginToCallbacks = GeneratedPluginIndex.pluginToCallbacks

    init {
        Log.i(TAG, "Plugin registry ready with ${pluginIdToClassName.size} plugin(s)")
    }

    @JavascriptInterface
    fun emit(payload: String?) {
        Log.i(TAG, "emit invoked. payloadPresent=${!payload.isNullOrBlank()}")

        if (payload.isNullOrBlank()) {
            sendError("Payload is required")
            return
        }

        try {
            val body = JSONObject(payload)
            val pluginId = body.optString("pluginId", "").trim()
            val command = body.optString("command", "").trim()
            val data = if (body.has("data") && !body.isNull("data")) body.get("data") else null

            if (pluginId.isEmpty()) {
                sendError("pluginId is required")
                return
            }
            if (command.isEmpty()) {
                sendError("Command is required")
                return
            }

            Log.i(TAG, "Dispatch request received for pluginId=$pluginId command=$command")

            if (!hasPlugin(pluginId)) {
                sendError("Unsupported plugin: $pluginId", pluginId)
                return
            }

            if (!hasCommand(pluginId, command)) {
                sendError("Unsupported command '$command' for plugin '$pluginId'", pluginId)
                return
            }

            val plugin = getPluginForId(pluginId)
            if (plugin == null) {
                sendError("No plugin registered for id: $pluginId", pluginId)
                return
            }

            val callbackContext = PluginBridgeContext(
                webView = webView,
                pluginId = pluginId,
                allowedCallbacks = pluginToCallbacks[pluginId] ?: emptySet()
            )

            Log.i(TAG, "Invoking plugin handler for command=$command plugin=${plugin.javaClass.name}")
            plugin.handle(command, data, callbackContext)
            Log.i(TAG, "Plugin handler completed for command=$command")
        } catch (error: JSONException) {
            sendError("Invalid JSON payload: ${error.message}")
        } catch (error: Exception) {
            Log.e(TAG, "Plugin command failed", error)
            sendError("Plugin execution failed: ${error.message}")
        }
    }

    private fun sendError(message: String, pluginId: String = SYSTEM_PLUGIN_ID) {
        PluginBridgeContext(webView, pluginId, setOf(ERROR_EVENT)).callback(
            ERROR_EVENT,
            JSONObject().apply {
                put("message", message)
                put("source", TAG)
                put("pluginId", pluginId)
            }
        )
    }

    private fun hasPlugin(pluginId: String): Boolean {
        return pluginIdToClassName.containsKey(pluginId)
    }

    private fun hasCommand(pluginId: String, command: String): Boolean {
        return pluginToCommands[pluginId]?.contains(command) ?: false
    }

    private fun getPluginForId(pluginId: String): CatalystPlugin? {
        val className = pluginIdToClassName[pluginId] ?: return null

        return try {
            val clazz = Class.forName(className)
            val instance = clazz.getDeclaredConstructor().newInstance()
            instance as? CatalystPlugin
                ?: throw IllegalStateException("Plugin class '$className' must implement CatalystPlugin")
        } catch (error: Exception) {
            Log.e(TAG, "Failed to instantiate plugin class $className for plugin $pluginId", error)
            null
        }
    }
}

class PluginBridgeContext(
    private val webView: WebView,
    private val pluginId: String,
    private val allowedCallbacks: Set<String>
) {
    companion object {
        private const val TAG = "PluginBridgeContext"
    }

    fun callback(eventName: String, data: Any?) {
        if (eventName.isBlank()) {
            Log.e(TAG, "Rejected callback with blank event name")
            return
        }
        if (!allowedCallbacks.contains(eventName)) {
            Log.e(TAG, "Rejected undeclared callback event=$eventName")
            return
        }

        val pluginLiteral = JSONObject.quote(pluginId)
        val eventLiteral = JSONObject.quote(eventName)
        val dataLiteral = toJavaScriptLiteral(data)
        Log.i(TAG, "Sending callback to web pluginId=$pluginId event=$eventName")

        webView.post {
            webView.evaluateJavascript(
                "window.PluginBridgeWeb && window.PluginBridgeWeb.callback($pluginLiteral, $eventLiteral, $dataLiteral);",
                null
            )
        }
    }

    private fun toJavaScriptLiteral(value: Any?): String {
        return when (value) {
            null -> "null"
            is JSONObject -> value.toString()
            is JSONArray -> value.toString()
            is Number, is Boolean -> value.toString()
            is String -> JSONObject.quote(value)
            else -> JSONObject.wrap(value)?.toString() ?: "null"
        }
    }
}
