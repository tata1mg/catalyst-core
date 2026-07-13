package io.yourname.androidproject

import android.content.Context
import android.util.Log
import android.util.LruCache
import android.webkit.WebResourceResponse
import io.yourname.androidproject.BuildConfig
import io.yourname.androidproject.utils.PerfEventBuffer
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class WebCacheManager(private val context: Context, private val properties: java.util.Properties? = null) {
    private val TAG = "WebCacheManager"
    private val FLOW_TAG = "CatalystOfflineFlow"
    private val cacheDir = File(context.cacheDir, "webview_cache")
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val BUFFER_SIZE = 32 * 1024 

    // Cache timing configurations - now configurable via properties
    private val maxAge = properties?.getProperty("cache.maxAge", "24")?.toLongOrNull()?.let { TimeUnit.HOURS.toMillis(it) } 
        ?: TimeUnit.HOURS.toMillis(24) // Default 24 hours
    private val staleWhileRevalidate = properties?.getProperty("cache.staleWhileRevalidate", "1")?.toLongOrNull()?.let { TimeUnit.HOURS.toMillis(it) } 
        ?: TimeUnit.HOURS.toMillis(1) // Default 1 hour
    private val maxCacheSize = properties?.getProperty("cache.maxSize", "100")?.toLongOrNull()?.let { it * 1024 * 1024 } 
        ?: (100 * 1024 * 1024) // Default 100MB
    private val memoryFraction = properties?.getProperty("cache.memoryFraction", "8")?.toIntOrNull() ?: 8 // Default 1/8 of memory

    // Track ongoing revalidations to prevent duplicate requests
    private val ongoingRevalidations = mutableSetOf<String>()

    // Memory cache - now configurable
    private val memoryCache: LruCache<String, CacheEntry> = LruCache<String, CacheEntry>(
        (Runtime.getRuntime().maxMemory() / 1024 / memoryFraction).toInt()
    )

    private fun emitCachePerfEvent(type: String, url: String, startMs: Long, statusCode: Int? = null) {
        if (!BuildConfig.DEBUG) return
        PerfEventBuffer.add(JSONObject().apply {
            put("type", type)
            put("url", url)
            put("nativeStartMs", startMs)
            put("durationMs", android.os.SystemClock.elapsedRealtime() - startMs)
            put("resourceType", when {
                url.endsWith(".js") -> "script"
                url.endsWith(".css") -> "stylesheet"
                url.endsWith(".png") || url.endsWith(".jpg") || url.endsWith(".jpeg") || url.endsWith(".svg") -> "image"
                else -> "other"
            })
            put("thread", Thread.currentThread().name)
            statusCode?.let { put("statusCode", it) }
        })
    }

    init {
        try {
            cacheDir.mkdirs()
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "📦 Cache configuration:")
                Log.d(TAG, "  - Max age: ${maxAge / (1000 * 60 * 60)} hours")
                Log.d(TAG, "  - Stale while revalidate: ${staleWhileRevalidate / (1000 * 60 * 60)} hours")
                Log.d(TAG, "  - Max cache size: ${maxCacheSize / (1024 * 1024)} MB")
                Log.d(TAG, "  - Memory cache size: ${memoryCache.maxSize() / 1024} KB")
                Log.d(TAG, "  - Cache directory: ${cacheDir.absolutePath}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create cache directory: ${e.message}")
        }
    }

    private data class CacheEntry(
        val data: ByteArray,
        val mimeType: String,
        val encoding: String,
        val responseHeaders: Map<String, String> = emptyMap(),
        val timestamp: Long = System.currentTimeMillis(),
        val eTag: String? = null,
        val lastModified: String? = null
    ) {
        fun toResponse(): WebResourceResponse {
            return WebResourceResponse(
                mimeType,
                encoding,
                200,
                "OK",
                responseHeaders.ifEmpty { null },
                ByteArrayInputStream(data)
            )
        }
    }

    /**
     * Synchronous cache check - only returns cached content if immediately available
     * Does not perform network requests or background revalidation
     * Used by ServiceWorker to avoid blocking
     */
    @Suppress("UNUSED_PARAMETER")
    fun getCachedResponseSync(url: String, headers: Map<String, String>): WebResourceResponse? {
        return try {
            val startMs = android.os.SystemClock.elapsedRealtime()
            val cacheKey = generateCacheKey(url)
            val currentTime = System.currentTimeMillis()

            // Check memory cache first
            val memoryCacheEntry = memoryCache.get(cacheKey)
            if (memoryCacheEntry != null) {
                val age = currentTime - memoryCacheEntry.timestamp
                // Only return if fresh or within stale-while-revalidate window
                if (age <= maxAge + staleWhileRevalidate) {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "✅ Serving from memory cache (sync): $url")
                        Log.d(FLOW_TAG, "ASSET cache-hit source=memory ageMs=$age url=$url")
                    }
                    emitCachePerfEvent("cache-hit-memory", url, startMs)
                    return memoryCacheEntry.toResponse()
                }
                if (BuildConfig.DEBUG) {
                    Log.d(FLOW_TAG, "ASSET cache-expired source=memory ageMs=$age url=$url")
                }
            }

            // Check disk cache synchronously
            val cacheFile = File(cacheDir, cacheKey)
            if (cacheFile.exists()) {
                val fileAge = currentTime - cacheFile.lastModified()
                if (fileAge <= maxAge + staleWhileRevalidate) {
                    val metadata = loadMetadata(cacheKey)
                    val response = createResponseFromCache(cacheFile, metadata)
                    memoryCache.put(cacheKey, createEntryFromCache(cacheFile, metadata, cacheFile.lastModified()))
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "✅ Serving from disk cache (sync): $url")
                        Log.d(FLOW_TAG, "ASSET cache-hit source=disk ageMs=$fileAge bytes=${cacheFile.length()} mime=${metadata.mimeType} encoding=${metadata.encoding} url=$url")
                    }
                    emitCachePerfEvent("cache-hit-disk", url, startMs)
                    return response
                }
                if (BuildConfig.DEBUG) {
                    Log.d(FLOW_TAG, "ASSET cache-expired source=disk ageMs=$fileAge bytes=${cacheFile.length()} url=$url")
                }
            }

            // No valid cache available
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "❌ No valid cache available (sync): $url")
                Log.d(FLOW_TAG, "ASSET cache-miss url=$url")
            }
            emitCachePerfEvent("cache-miss-fetch", url, startMs)
            null
        } catch (e: Exception) {
            Log.e(TAG, "Error in getCachedResponseSync for URL: $url: ${e.message}")
            if (BuildConfig.DEBUG) {
                Log.e(FLOW_TAG, "ASSET cache-error phase=read url=$url error=${e.message}", e)
            }
            null
        }
    }

    /**
     * Synchronous cache-or-network path for WebView interception.
     *
     * shouldInterceptRequest runs off the UI thread, so it is safe to block here.
     * Returning the fetched response from this method guarantees that the same
     * request which populated the cache also succeeds in the WebView.
     */
    fun getCachedResponseOrFetchSync(url: String, headers: Map<String, String>): WebResourceResponse? {
        return try {
            getCachedResponseSync(url, headers) ?: fetchAndCacheResourceBlocking(url, headers, generateCacheKey(url))
        } catch (e: Exception) {
            Log.e(TAG, "Error in getCachedResponseOrFetchSync for URL: $url: ${e.message}")
            if (BuildConfig.DEBUG) {
                Log.e(FLOW_TAG, "ASSET cache-error phase=cache-or-fetch url=$url error=${e.message}", e)
            }
            null
        }
    }

    suspend fun getCachedResponse(url: String, headers: Map<String, String>): WebResourceResponse? =
        withContext(Dispatchers.IO) {
            try {
                val cacheKey = generateCacheKey(url)
                val currentTime = System.currentTimeMillis()

                // Check memory cache first
                val memoryCacheEntry = memoryCache.get(cacheKey)
                if (memoryCacheEntry != null) {
                    val age = currentTime - memoryCacheEntry.timestamp

                    when {
                        age <= maxAge -> {
                            // Fresh content
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "Serving fresh content from memory cache: $url")
                            }
                            return@withContext memoryCacheEntry.toResponse()
                        }
                        age <= maxAge + staleWhileRevalidate -> {
                            // Stale content, but within revalidate window
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "Serving stale content while revalidating: $url")
                            }
                            revalidateInBackground(url, headers, cacheKey, memoryCacheEntry)
                            return@withContext memoryCacheEntry.toResponse()
                        }
                    }
                }

                // Check disk cache
                val cacheFile = File(cacheDir, cacheKey)
                if (cacheFile.exists()) {
                    val fileAge = currentTime - cacheFile.lastModified()
                    val metadata = loadMetadata(cacheKey)

                    when {
                        fileAge <= maxAge -> {
                            // Fresh content from disk
                            val response = createResponseFromCache(cacheFile, metadata)
                            memoryCache.put(cacheKey, createEntryFromCache(cacheFile, metadata, cacheFile.lastModified()))
                            return@withContext response
                        }
                        fileAge <= maxAge + staleWhileRevalidate -> {
                            // Stale content from disk, revalidate in background
                            val response = createResponseFromCache(cacheFile, metadata)
                            val cacheEntry = createEntryFromCache(cacheFile, metadata, cacheFile.lastModified())
                            revalidateInBackground(url, headers, cacheKey, cacheEntry)
                            return@withContext response
                        }
                    }
                }

                // No cache or cache too old, fetch fresh content
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "❌ Cache miss, fetching fresh content: $url")
                }
                fetchAndCacheResourceBlocking(url, headers, cacheKey)
            } catch (e: Exception) {
                Log.e(TAG, "Error in getCachedResponse for URL: $url: ${e.message}")
                if (BuildConfig.DEBUG) {
                    e.printStackTrace()
                }
                null
            }
        }

    fun clearAll() {
        try {
            memoryCache.evictAll()
            cacheDir.listFiles()?.forEach { it.delete() }
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "clearAll: memory cache and disk cache wiped")
            }
        } catch (e: Exception) {
            Log.e(TAG, "clearAll failed: ${e.message}")
        }
    }

    suspend fun cleanup() {
        withContext(Dispatchers.IO) {
            try {
                val currentTime = System.currentTimeMillis()
                // Use configurable max cache size
                var totalSize = 0L

                // Get all cache files sorted by last modified time (oldest first)
                val cacheFiles = cacheDir.listFiles()?.sortedBy { it.lastModified() } ?: return@withContext

                for (file in cacheFiles) {
                    val age = currentTime - file.lastModified()

                    // Delete if expired (older than maxAge + staleWhileRevalidate)
                    if (age > maxAge + staleWhileRevalidate) {
                        file.delete()
                        // Also delete corresponding metadata file if it exists
                        val metaFile = File(cacheDir, "${file.name}.meta")
                        if (metaFile.exists()) {
                            metaFile.delete()
                        }
                        continue
                    }

                    totalSize += file.length()
                }

                // If cache is too large, remove oldest files until under limit
                if (totalSize > maxCacheSize) {
                    val sortedFiles = cacheDir.listFiles()?.sortedBy { it.lastModified() } ?: return@withContext
                    for (file in sortedFiles) {
                        if (totalSize <= maxCacheSize) break

                        totalSize -= file.length()
                        file.delete()
                        // Delete corresponding metadata file
                        val metaFile = File(cacheDir, "${file.name}.meta")
                        if (metaFile.exists()) {
                            metaFile.delete()
                        }
                    }
                }

                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Cache cleanup completed. Current size: ${totalSize / 1024}KB")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error during cache cleanup: ${e.message}")
                if (BuildConfig.DEBUG) {
                    e.printStackTrace()
                }
            }
        }
    }

    private fun revalidateInBackground(
        url: String,
        headers: Map<String, String>,
        cacheKey: String,
        cacheEntry: CacheEntry
    ) {
        if (!ongoingRevalidations.add(cacheKey)) {
            // Revalidation already in progress
            return
        }

        scope.launch {
            try {
                val revalidationHeaders = headers.toMutableMap()
                cacheEntry.eTag?.let { revalidationHeaders["If-None-Match"] = it }
                cacheEntry.lastModified?.let { revalidationHeaders["If-Modified-Since"] = it }

                val connection = URL(url).openConnection() as HttpURLConnection
                revalidationHeaders.forEach { (key, value) ->
                    connection.setRequestProperty(key, value)
                }

                when (connection.responseCode) {
                    HttpURLConnection.HTTP_NOT_MODIFIED -> {
                        // Content still valid, update timestamp
                        val updatedEntry = cacheEntry.copy(timestamp = System.currentTimeMillis())
                        memoryCache.put(cacheKey, updatedEntry)
                        updateCacheFileTimestamp(cacheKey)
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "✅ Content revalidated, not modified: $url")
                        }
                    }
                    HttpURLConnection.HTTP_OK -> {
                        // Content changed, update cache
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "⚡ Content changed, updating cache: $url")
                        }
                        fetchAndCacheResourceBlocking(url, headers, cacheKey)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error during revalidation for URL: $url: ${e.message}")
                if (BuildConfig.DEBUG) {
                    e.printStackTrace()
                }
            } finally {
                ongoingRevalidations.remove(cacheKey)
            }
        }
    }

    private fun updateCacheFileTimestamp(cacheKey: String) {
        try {
            val cacheFile = File(cacheDir, cacheKey)
            if (cacheFile.exists()) {
                cacheFile.setLastModified(System.currentTimeMillis())
                File(cacheDir, "${cacheKey}.meta").setLastModified(System.currentTimeMillis())
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update cache file timestamp: ${e.message}")
        }
    }

    private fun fetchAndCacheResourceBlocking(
        url: String,
        headers: Map<String, String>,
        cacheKey: String
    ): WebResourceResponse? {
        var connection: HttpURLConnection? = null
        val startMs = android.os.SystemClock.elapsedRealtime()
        try {
            connection = URL(url).openConnection() as HttpURLConnection
            headers.forEach { (key, value) ->
                if (!key.equals("Accept-Encoding", ignoreCase = true)) {
                    connection.setRequestProperty(key, value)
                }
            }
            connection.setRequestProperty("Accept-Encoding", "identity")

            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            if (BuildConfig.DEBUG) {
                Log.d(FLOW_TAG, "ASSET network-fetch start url=$url headers=${headers.keys.sorted()}")
            }
            connection.connect()

            if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                val contentType = connection.contentType ?: "application/octet-stream"
                val mimeType = mimeTypeFromContentType(contentType)
                val encoding = charsetFromContentType(contentType)
                val eTag = connection.getHeaderField("ETag")
                val lastModified = connection.getHeaderField("Last-Modified")

                // Capture all response headers for replay on cache hits
                val savedHeaders = mutableMapOf<String, String>()
                var i = 0
                while (true) {
                    val key = connection.getHeaderFieldKey(i) ?: break
                    val value = connection.getHeaderField(i)
                    if (key.isNotEmpty() && shouldReplayHeader(key)) savedHeaders[key] = value
                    i++
                }
                savedHeaders["Content-Type"] = contentType

                val responseBytes = connection.inputStream.use { it.readBytes() }
                if (!isValidResponse(mimeType, responseBytes)) {
                    if (BuildConfig.DEBUG) {
                        Log.w(FLOW_TAG, "ASSET network-fetch invalid-response status=${connection.responseCode} contentType=$contentType bytes=${responseBytes.size} url=$url")
                    }
                    return null
                }

                // Create response for immediate use
                val response = WebResourceResponse(mimeType, encoding, 200, "OK", savedHeaders, ByteArrayInputStream(responseBytes))

                // Cache the response
                val cacheEntry = CacheEntry(
                    data = responseBytes.copyOf(),
                    mimeType = mimeType,
                    encoding = encoding,
                    responseHeaders = savedHeaders,
                    eTag = eTag,
                    lastModified = lastModified
                )
                memoryCache.put(cacheKey, cacheEntry)

                // Save to disk cache
                scope.launch {
                    try {
                        val cacheFile = File(cacheDir, cacheKey)
                        FileOutputStream(cacheFile).use { it.write(responseBytes) }
                        saveMetadata(cacheKey, CacheMetadata(
                            mimeType = mimeType,
                            encoding = encoding,
                            eTag = eTag,
                            lastModified = lastModified,
                            responseHeaders = savedHeaders
                        ))
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "✅ Successfully cached response for: $url")
                            Log.d(FLOW_TAG, "ASSET stored bytes=${responseBytes.size} mime=$mimeType encoding=$encoding url=$url")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error saving to disk cache for URL: $url: ${e.message}")
                        if (BuildConfig.DEBUG) {
                            Log.e(FLOW_TAG, "ASSET store-error url=$url error=${e.message}", e)
                        }
                    }
                }

                if (BuildConfig.DEBUG) {
                    Log.d(FLOW_TAG, "ASSET network-fetch success status=${connection.responseCode} bytes=${responseBytes.size} contentType=$contentType replayMime=$mimeType replayEncoding=$encoding url=$url")
                }
                emitCachePerfEvent("network-fetch-complete", url, startMs, connection.responseCode)
                return response
            }
            if (BuildConfig.DEBUG) {
                Log.w(FLOW_TAG, "ASSET network-fetch non-200 status=${connection.responseCode} contentType=${connection.contentType} url=$url")
            }
            return null
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching resource: ${e.message}")
            if (BuildConfig.DEBUG) {
                Log.e(FLOW_TAG, "ASSET network-fetch error url=$url error=${e.message}", e)
            }
            if (BuildConfig.DEBUG) {
                e.printStackTrace()
            }
            return null
        } finally {
            connection?.disconnect()
        }
    }

    private data class CacheMetadata(
        val mimeType: String,
        val encoding: String,
        val eTag: String? = null,
        val lastModified: String? = null,
        val responseHeaders: Map<String, String> = emptyMap()
    ) : Serializable

    private fun createResponseFromCache(cacheFile: File, metadata: CacheMetadata): WebResourceResponse {
        return WebResourceResponse(
            metadata.mimeType,
            metadata.encoding,
            200,
            "OK",
            metadata.responseHeaders.ifEmpty { null },
            BufferedInputStream(FileInputStream(cacheFile), BUFFER_SIZE)
        )
    }

    private fun mimeTypeFromContentType(contentType: String): String {
        return contentType.substringBefore(";").trim().ifEmpty { "application/octet-stream" }
    }

    private fun charsetFromContentType(contentType: String): String {
        val charsetPart = contentType
            .split(";")
            .map { it.trim() }
            .firstOrNull { it.startsWith("charset=", ignoreCase = true) }
        return charsetPart
            ?.substringAfter("=")
            ?.trim()
            ?.trim('"')
            ?.ifEmpty { null }
            ?: "utf-8"
    }

    private fun shouldReplayHeader(header: String): Boolean {
        return !header.equals("Content-Encoding", ignoreCase = true) &&
            !header.equals("Transfer-Encoding", ignoreCase = true) &&
            !header.equals("Content-Length", ignoreCase = true) &&
            !header.equals("Connection", ignoreCase = true)
    }

    private fun createEntryFromCache(
        cacheFile: File,
        metadata: CacheMetadata,
        timestamp: Long
    ): CacheEntry {
        return CacheEntry(
            data = cacheFile.readBytes(),
            mimeType = metadata.mimeType,
            encoding = metadata.encoding,
            responseHeaders = metadata.responseHeaders,
            timestamp = timestamp,
            eTag = metadata.eTag,
            lastModified = metadata.lastModified
        )
    }

    private fun generateCacheKey(url: String): String {
        try {
            val md = MessageDigest.getInstance("SHA-256")
            val digest = md.digest(url.toByteArray())
            return digest.joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Error generating cache key: ${e.message}")
            // Fallback to a simple hash code if SHA-256 fails
            return url.hashCode().toString()
        }
    }

    private fun isValidResponse(mimeType: String, responseBytes: ByteArray): Boolean {
        return try {
            if (responseBytes.isEmpty()) return false
            if (mimeType.isEmpty()) return false

            if (mimeType.startsWith("text/") ||
                mimeType.contains("json") ||
                mimeType.contains("javascript")
            ) {
                val content = String(responseBytes)
                if (content.isBlank()) return false
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error validating response: ${e.message}")
            false
        }
    }

    private fun saveMetadata(cacheKey: String, metadata: CacheMetadata) {
        try {
            val metadataFile = File(cacheDir, "${cacheKey}.meta")
            ObjectOutputStream(FileOutputStream(metadataFile)).use {
                it.writeObject(metadata)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error saving metadata: ${e.message}")
        }
    }

    private fun loadMetadata(cacheKey: String): CacheMetadata {
        try {
            val metadataFile = File(cacheDir, "${cacheKey}.meta")
            return ObjectInputStream(FileInputStream(metadataFile)).use {
                it.readObject() as CacheMetadata
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading metadata: ${e.message}")
            // Return a default metadata object if loading fails
            return CacheMetadata(
                mimeType = "application/octet-stream",
                encoding = "utf-8"
            )
        }
    }
}
