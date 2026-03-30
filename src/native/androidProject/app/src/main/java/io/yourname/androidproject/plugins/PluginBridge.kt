package io.yourname.androidproject.plugins

import android.app.Activity
import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import io.yourname.androidproject.CatalystConstants
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.Properties

internal data class PluginRequest(
    val pluginId: String,
    val command: String,
    val data: Any?,
    val requestId: String?
)

private class PluginBridgeRuntimeError(
    override val message: String,
    val code: String,
    cause: Throwable? = null
) : Exception(message, cause)

class PluginBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val properties: Properties
) {
    companion object {
        private const val TAG = "PluginBridge"
        private const val ERROR_EVENT = "PLUGIN_BRIDGE_ERROR"
        private const val SYSTEM_PLUGIN_ID = "__bridge__"
        private const val ERROR_CODE_INVALID_PAYLOAD = "INVALID_PAYLOAD"
        private const val ERROR_CODE_PLUGIN_NOT_FOUND = "PLUGIN_NOT_FOUND"
        private const val ERROR_CODE_COMMAND_NOT_SUPPORTED = "COMMAND_NOT_SUPPORTED"
        private const val ERROR_CODE_PLUGIN_NOT_REGISTERED = "PLUGIN_NOT_REGISTERED"
        private const val ERROR_CODE_PLUGIN_INSTANTIATION_FAILED = "PLUGIN_INSTANTIATION_FAILED"
        private const val ERROR_CODE_PLUGIN_EXECUTION_FAILED = "PLUGIN_EXECUTION_FAILED"

        private fun readRequiredString(body: JSONObject, key: String): String {
            if (!body.has(key) || body.isNull(key)) {
                return ""
            }

            val rawValue = body.get(key)
            if (rawValue !is String) {
                throw IllegalArgumentException("$key must be a string")
            }

            return rawValue.trim()
        }

        private fun readOptionalString(body: JSONObject, key: String): String? {
            if (!body.has(key) || body.isNull(key)) {
                return null
            }

            val rawValue = body.get(key)
            if (rawValue !is String) {
                throw IllegalArgumentException("$key must be a string when provided")
            }

            return rawValue.trim().ifEmpty { null }
        }

        internal fun parseRequest(payload: String?): PluginRequest {
            if (payload.isNullOrBlank()) {
                throw IllegalArgumentException("Payload is required")
            }
            val messageSize = payload.toByteArray(Charsets.UTF_8).size
            if (messageSize > CatalystConstants.Bridge.MAX_MESSAGE_SIZE) {
                throw IllegalArgumentException("Payload exceeds maximum size")
            }

            val body = JSONObject(payload)
            return PluginRequest(
                pluginId = readRequiredString(body, "pluginId"),
                command = readRequiredString(body, "command"),
                data = if (body.has("data") && !body.isNull("data")) body.get("data") else null,
                requestId = readOptionalString(body, "requestId")
            )
        }
    }

    private val pluginIdToClassName = GeneratedPluginIndex.pluginIdToClassName
    private val pluginToCommands = GeneratedPluginIndex.pluginToCommands
    private val pluginToCallbacks = GeneratedPluginIndex.pluginToCallbacks

    @JavascriptInterface
    fun emit(payload: String?) {
        var request: PluginRequest? = null

        try {
            request = parseRequest(payload)

            if (request.pluginId.isEmpty()) {
                sendBridgeError("pluginId is required", ERROR_CODE_INVALID_PAYLOAD, request)
                return
            }
            if (request.command.isEmpty()) {
                sendBridgeError("command is required", ERROR_CODE_INVALID_PAYLOAD, request)
                return
            }

            if (!hasPlugin(request.pluginId)) {
                sendBridgeError("Unsupported plugin: ${request.pluginId}", ERROR_CODE_PLUGIN_NOT_FOUND, request)
                return
            }

            if (!hasCommand(request.pluginId, request.command)) {
                sendBridgeError(
                    "Unsupported command '${request.command}' for plugin '${request.pluginId}'",
                    ERROR_CODE_COMMAND_NOT_SUPPORTED,
                    request
                )
                return
            }

            val plugin = try {
                getPluginForId(request.pluginId)
            } catch (error: PluginBridgeRuntimeError) {
                sendBridgeError(error.message, error.code, request)
                return
            }

            val callbackContext = PluginBridgeContext(
                activity = activity,
                webView = webView,
                properties = properties,
                pluginId = request.pluginId,
                command = request.command,
                requestId = request.requestId,
                allowedCallbacks = pluginToCallbacks[request.pluginId] ?: emptySet()
            )

            plugin.handle(request.command, request.data, callbackContext)
        } catch (error: IllegalArgumentException) {
            sendBridgeError(error.message ?: "Invalid payload", ERROR_CODE_INVALID_PAYLOAD, request)
        } catch (error: JSONException) {
            sendBridgeError("Invalid JSON payload: ${error.message}", ERROR_CODE_INVALID_PAYLOAD, request)
        } catch (error: Exception) {
            Log.e(TAG, "Plugin command failed for ${request?.pluginId ?: "<unknown>"}.${request?.command ?: "<unknown>"}", error)
            sendBridgeError("Plugin execution failed: ${error.message}", ERROR_CODE_PLUGIN_EXECUTION_FAILED, request)
        }
    }

    private fun sendBridgeError(message: String, code: String, request: PluginRequest?) {
        PluginBridgeContext(
            activity = activity,
            webView = webView,
            properties = properties,
            pluginId = SYSTEM_PLUGIN_ID,
            command = request?.command,
            requestId = request?.requestId,
            allowedCallbacks = setOf(ERROR_EVENT)
        ).callback(
            ERROR_EVENT,
            JSONObject().apply {
                put("message", message)
                put("code", code)
                put("pluginId", request?.pluginId ?: SYSTEM_PLUGIN_ID)
                request?.command?.takeIf { it.isNotEmpty() }?.let { put("command", it) }
                request?.requestId?.let { put("requestId", it) }
            }
        )
    }

    private fun hasPlugin(pluginId: String): Boolean {
        return pluginIdToClassName.containsKey(pluginId)
    }

    private fun hasCommand(pluginId: String, command: String): Boolean {
        return pluginToCommands[pluginId]?.contains(command) ?: false
    }

    private fun getPluginForId(pluginId: String): CatalystPlugin {
        val className = pluginIdToClassName[pluginId]
            ?: throw PluginBridgeRuntimeError(
                "No plugin registered for id: $pluginId",
                ERROR_CODE_PLUGIN_NOT_REGISTERED
            )

        return try {
            val clazz = Class.forName(className)
            val instance = clazz.getDeclaredConstructor().newInstance()
            instance as? CatalystPlugin
                ?: throw IllegalStateException("Plugin class '$className' must implement CatalystPlugin")
        } catch (error: Exception) {
            Log.e(TAG, "Failed to instantiate plugin class $className for plugin $pluginId", error)
            throw PluginBridgeRuntimeError(
                "Failed to instantiate plugin class '$className' for plugin '$pluginId': ${error.message ?: error.javaClass.simpleName}",
                ERROR_CODE_PLUGIN_INSTANTIATION_FAILED,
                error
            )
        }
    }
}

class PluginBridgeContext(
    val activity: Activity,
    val webView: WebView,
    val properties: Properties,
    val pluginId: String,
    val command: String?,
    val requestId: String?,
    private val allowedCallbacks: Set<String>
) {
    val context: Context
        get() = activity

    fun callback(
        eventName: String,
        data: Any?,
        requestId: String? = this.requestId,
        command: String? = this.command
    ) {
        require(eventName.isNotBlank()) { "Callback eventName is required" }
        require(allowedCallbacks.contains(eventName)) {
            "Undeclared callback '$eventName' for plugin '$pluginId'"
        }

        val pluginLiteral = JSONObject.quote(pluginId)
        val eventLiteral = JSONObject.quote(eventName)
        val dataLiteral = toJavaScriptLiteral(data)
        val requestLiteral = requestId?.let(JSONObject::quote) ?: "null"
        val commandLiteral = command?.takeIf { it.isNotBlank() }?.let(JSONObject::quote) ?: "null"

        webView.post {
            webView.evaluateJavascript(
                "window.PluginBridgeWeb && window.PluginBridgeWeb.callback($pluginLiteral, $eventLiteral, $dataLiteral, $requestLiteral, $commandLiteral);",
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
