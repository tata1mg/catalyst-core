package io.yourname.androidproject

import android.content.Context
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceResponse
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class OfflineCacheService(
    context: Context
) {
    companion object {
        private const val SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000L
        private val ASSET_EXTENSIONS = setOf(
            ".js",
            ".mjs",
            ".css",
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".svg",
            ".webp",
            ".ico",
            ".woff",
            ".woff2",
            ".ttf",
            ".eot"
        )
    }

    private val TAG = "OfflineCacheService"
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val rootDir = File(context.cacheDir, "catalyst_offline")
    private val routeRootDir = File(rootDir, "routes")
    private val manifestFile = File(rootDir, "manifest.json")
    private val ongoingSnapshots = mutableSetOf<String>()

    @Volatile
    private var manifest: OfflineManifest? = loadCachedManifest()

    data class OfflineManifest(
        val buildId: String,
        val routes: List<OfflineRoute>
    )

    data class OfflineRoute(
        val pattern: String,
        val regex: String
    )

    init {
        rootDir.mkdirs()
        routeRootDir.mkdirs()
    }

    fun refreshManifestAsync(url: String, headers: Map<String, String> = emptyMap()) {
        if (!isHttpUrl(url)) return

        scope.launch {
            refreshManifestBlocking(url, headers)
        }
    }

    fun storeRouteSnapshotAsync(url: String, headers: Map<String, String> = emptyMap()) {
        if (!isHttpUrl(url)) return
        val key = normalizeSnapshotUrl(url)

        val shouldFetch = synchronized(ongoingSnapshots) {
            ongoingSnapshots.add(key)
        }

        if (!shouldFetch) return

        scope.launch {
            try {
                refreshManifestBlocking(url, headers)
                if (!isOfflineRouteUrl(url)) return@launch

                val file = snapshotFileForUrl(key)
                if (isFreshSnapshot(file)) return@launch

                val connection = URL(key).openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
                connection.setRequestProperty("X-Catalyst-Offline-Snapshot-Fetch", "1")
                headers.forEach { (header, value) ->
                    if (shouldForwardHeader(header)) connection.setRequestProperty(header, value)
                }
                CookieManager.getInstance().getCookie(key)?.takeIf { it.isNotBlank() }?.let {
                    connection.setRequestProperty("Cookie", it)
                }

                connection.connect()
                val contentType = connection.contentType ?: ""

                if (connection.responseCode == HttpURLConnection.HTTP_OK &&
                    contentType.contains("text/html", ignoreCase = true)
                ) {
                    val bytes = connection.inputStream.use { it.readBytes() }
                    if (bytes.isNotEmpty()) {
                        file.parentFile?.mkdirs()
                        FileOutputStream(file).use { it.write(bytes) }
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "Stored route snapshot: $key")
                        }
                    }
                }
                connection.disconnect()
            } catch (e: Exception) {
                if (BuildConfig.DEBUG) {
                    Log.w(TAG, "Unable to store route snapshot for $url: ${e.message}")
                }
            } finally {
                synchronized(ongoingSnapshots) {
                    ongoingSnapshots.remove(key)
                }
            }
        }
    }

    fun getRouteSnapshotResponse(url: String): WebResourceResponse? {
        if (!isOfflineRouteUrl(url)) return null
        val file = snapshotFileForUrl(url)
        if (!file.exists()) return null

        return WebResourceResponse(
            "text/html",
            "utf-8",
            200,
            "OK",
            mapOf("X-Catalyst-Offline-Snapshot" to "hit"),
            BufferedInputStream(FileInputStream(file))
        )
    }

    fun loadSnapshotInto(webView: WebView, url: String): Boolean {
        if (!isOfflineRouteUrl(url)) return false
        val file = snapshotFileForUrl(url)
        if (!file.exists()) return false

        return try {
            val bytes = file.readBytes()
            webView.loadDataWithBaseURL(
                normalizeSnapshotUrl(url),
                String(bytes, Charsets.UTF_8),
                "text/html",
                "UTF-8",
                normalizeSnapshotUrl(url)
            )
            true
        } catch (e: Exception) {
            Log.e(TAG, "Unable to load route snapshot for $url: ${e.message}")
            false
        }
    }

    fun isOfflineRouteUrl(url: String): Boolean {
        if (!isHttpUrl(url)) return false
        val currentManifest = manifest ?: return false
        val path = Uri.parse(url).path ?: "/"

        return currentManifest.routes.any { route ->
            try {
                Regex(route.regex, RegexOption.IGNORE_CASE).matches(path)
            } catch (_: Exception) {
                false
            }
        }
    }

    fun shouldCacheAssetUrl(url: String): Boolean {
        if (!isHttpUrl(url)) return false
        val path = Uri.parse(url).path?.lowercase() ?: return false
        return ASSET_EXTENSIONS.any { path.endsWith(it) }
    }

    fun clearAll() {
        try {
            deleteRecursively(rootDir)
            rootDir.mkdirs()
            routeRootDir.mkdirs()
            manifest = null
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Offline route snapshots cleared")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Unable to clear offline cache: ${e.message}")
        }
    }

    private fun refreshManifestBlocking(url: String, headers: Map<String, String>): OfflineManifest? {
        return try {
            val manifestUrl = manifestUrlFor(url)
            val connection = URL(manifestUrl).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            headers.forEach { (header, value) ->
                if (shouldForwardHeader(header)) connection.setRequestProperty(header, value)
            }
            CookieManager.getInstance().getCookie(manifestUrl)?.takeIf { it.isNotBlank() }?.let {
                connection.setRequestProperty("Cookie", it)
            }
            connection.connect()

            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                connection.disconnect()
                return manifest
            }

            val body = connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            connection.disconnect()
            val parsed = parseManifest(body)
            manifestFile.writeText(body)
            manifest = parsed
            parsed
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) {
                Log.w(TAG, "Unable to refresh offline manifest: ${e.message}")
            }
            manifest
        }
    }

    private fun loadCachedManifest(): OfflineManifest? {
        return try {
            if (!manifestFile.exists()) return null
            parseManifest(manifestFile.readText())
        } catch (_: Exception) {
            null
        }
    }

    private fun parseManifest(raw: String): OfflineManifest {
        val json = JSONObject(raw)
        val buildId = json.optString("buildId", "unknown")
        val routesJson = json.optJSONArray("routes")
        val routes = mutableListOf<OfflineRoute>()
        if (routesJson != null) {
            for (index in 0 until routesJson.length()) {
                val route = routesJson.optJSONObject(index) ?: continue
                val pattern = route.optString("pattern")
                val regex = route.optString("regex")
                if (pattern.isNotBlank() && regex.isNotBlank()) {
                    routes.add(OfflineRoute(pattern, regex))
                }
            }
        }

        return OfflineManifest(buildId, routes)
    }

    private fun snapshotFileForUrl(url: String): File {
        val normalizedUrl = normalizeSnapshotUrl(url)
        val namespace = manifest?.let { "${originFor(normalizedUrl)}:${it.buildId}" } ?: originFor(normalizedUrl)
        val namespaceDir = File(routeRootDir, hash(namespace))
        return File(namespaceDir, "${hash(normalizedUrl)}.html")
    }

    private fun manifestUrlFor(url: String): String {
        val uri = Uri.parse(url)
        return "${uri.scheme}://${uri.authority}/catalyst-offline-manifest.json"
    }

    private fun originFor(url: String): String {
        val uri = Uri.parse(url)
        return "${uri.scheme}://${uri.authority}"
    }

    private fun normalizeSnapshotUrl(url: String): String {
        val uri = Uri.parse(url)
        return uri.buildUpon().fragment(null).build().toString()
    }

    private fun isHttpUrl(url: String): Boolean {
        val scheme = Uri.parse(url).scheme?.lowercase()
        return scheme == "http" || scheme == "https"
    }

    private fun shouldForwardHeader(header: String): Boolean {
        return !header.equals("Cookie", ignoreCase = true) &&
            !header.equals("Host", ignoreCase = true) &&
            !header.equals("Cache-Control", ignoreCase = true) &&
            !header.equals("Pragma", ignoreCase = true)
    }

    private fun isFreshSnapshot(file: File): Boolean {
        return file.exists() && System.currentTimeMillis() - file.lastModified() < SNAPSHOT_MAX_AGE_MS
    }

    private fun hash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun deleteRecursively(file: File) {
        if (!file.exists()) return
        if (file.isDirectory) {
            file.listFiles()?.forEach { deleteRecursively(it) }
        }
        file.delete()
    }
}
