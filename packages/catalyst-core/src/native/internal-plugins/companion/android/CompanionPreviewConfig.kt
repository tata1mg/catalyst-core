package io.yourname.androidproject.plugins.internal.companion

import android.net.Uri
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.text.Charsets.UTF_8

internal object CompanionPreviewConfig {

    private const val TAG = "CompanionPlugin"
    private const val CONFIG_PATH = "/__catalyst/preview-config"
    private const val TIMEOUT_MS = 3_000
    private const val SCHEMA = 1
    private const val MAX_RESPONSE_BYTES = 64 * 1024

    fun originOf(url: Uri): String {
        val scheme = url.scheme ?: "http"
        val rawHost = url.host ?: ""
        val host = if (':' in rawHost) "[$rawHost]" else rawHost
        val port = url.port
        return if (port == -1) "$scheme://$host" else "$scheme://$host:$port"
    }

    fun fetch(origin: String): JSONObject? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$origin$CONFIG_PATH").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                useCaches = false
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
            }

            val status = connection.responseCode
            if (status != HttpURLConnection.HTTP_OK) {
                return null
            }

            val body = connection.inputStream.use(::readBody)
                ?: return null
            val parsed = JSONObject(body.toString(UTF_8))
            val schema = parsed.opt("schema")
            if (schema !is Number || schema.toDouble() != SCHEMA.toDouble()) {
                return null
            }
            val config = parsed.optJSONObject("config")
                ?: return null

            config
        } catch (error: Exception) {
            Log.w(TAG, "Preview config fetch failed: ${error.message}")
            null
        } finally {
            try {
                connection?.disconnect()
            } catch (_: Exception) {}
        }
    }

    fun toPropertyMap(config: JSONObject?): Map<String, String> {
        val values = LinkedHashMap<String, String>()
        config?.let { flatten(it, "", values) }
        return values
    }

    private fun flatten(source: JSONObject, prefix: String, target: MutableMap<String, String>) {
        source.keys().forEach { key ->
            val path = if (prefix.isEmpty()) key else "$prefix.$key"
            when (val value = source.get(key)) {
                is JSONObject -> flatten(value, path, target)
                is JSONArray -> target[path] = (0 until value.length())
                    .joinToString(",") { value.get(it).toString() }
                JSONObject.NULL -> Unit
                else -> target[path] = value.toString()
            }
        }
    }

    private fun readBody(input: InputStream): ByteArray? {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (output.size() + count > MAX_RESPONSE_BYTES) return null
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }
}
