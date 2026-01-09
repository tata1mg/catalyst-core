package io.yourname.androidproject

import android.content.Context
import android.util.Log
import android.util.LruCache
import android.webkit.WebResourceResponse
import io.yourname.androidproject.BuildConfig
import kotlinx.coroutines.*
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class WebCacheManager(private val context: Context, private val properties: java.util.Properties? = null) {
    private val TAG = "WebCacheManager"
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

    data class CacheEntry(
        val response: WebResourceResponse,
        val timestamp: Long = System.currentTimeMillis(),
        val eTag: String? = null,
        val lastModified: String? = null
    )

    /**
     * Synchronous cache check - only returns cached content if immediately available
     * Does not perform network requests or background revalidation
     * Used by ServiceWorker to avoid blocking
     */
    fun getCachedResponseSync(url: String, headers: Map<String, String>): WebResourceResponse? {
        return try {
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
                    }
                    return memoryCacheEntry.response
                }
            }

            // Check disk cache synchronously
            val cacheFile = File(cacheDir, cacheKey)
            if (cacheFile.exists()) {
                val fileAge = currentTime - cacheFile.lastModified()
                if (fileAge <= maxAge + staleWhileRevalidate) {
                    val metadata = loadMetadata(cacheKey)
                    val response = createResponseFromCache(cacheFile, metadata)
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "✅ Serving from disk cache (sync): $url")
                    }
                    return response
                }
            }

            // No valid cache available
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "❌ No valid cache available (sync): $url")
            }
            null
        } catch (e: Exception) {
            Log.e(TAG, "Error in getCachedResponseSync for URL: $url: ${e.message}")
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
                            return@withContext memoryCacheEntry.response
                        }
                        age <= maxAge + staleWhileRevalidate -> {
                            // Stale content, but within revalidate window
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "Serving stale content while revalidating: $url")
                            }
                            revalidateInBackground(url, headers, cacheKey, memoryCacheEntry)
                            return@withContext memoryCacheEntry.response
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
                            memoryCache.put(cacheKey, CacheEntry(response))
                            return@withContext response
                        }
                        fileAge <= maxAge + staleWhileRevalidate -> {
                            // Stale content from disk, revalidate in background
                            val response = createResponseFromCache(cacheFile, metadata)
                            val cacheEntry = CacheEntry(
                                response = response,
                                timestamp = cacheFile.lastModified(),
                                eTag = metadata.eTag,
                                lastModified = metadata.lastModified
                            )
                            revalidateInBackground(url, headers, cacheKey, cacheEntry)
                            return@withContext response
                        }
                    }
                }

                // No cache or cache too old, fetch fresh content
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "❌ Cache miss, fetching fresh content: $url")
                }
                fetchAndCacheResource(url, headers, cacheKey)
            } catch (e: Exception) {
                Log.e(TAG, "Error in getCachedResponse for URL: $url: ${e.message}")
                if (BuildConfig.DEBUG) {
                    e.printStackTrace()
                }
                null
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
                        fetchAndCacheResource(url, headers, cacheKey)
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

    private suspend fun fetchAndCacheResource(
        url: String,
        headers: Map<String, String>,
        cacheKey: String
    ): WebResourceResponse? = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = URL(url).openConnection() as HttpURLConnection
            headers.forEach { (key, value) ->
                connection.setRequestProperty(key, value)
            }

            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            connection.connect()

            if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                val mimeType = connection.contentType ?: "application/octet-stream"
                val encoding = connection.contentEncoding ?: "utf-8"
                val eTag = connection.getHeaderField("ETag")
                val lastModified = connection.getHeaderField("Last-Modified")

                val responseBytes = connection.inputStream.use { it.readBytes() }
                if (!isValidResponse(mimeType, responseBytes)) {
                    return@withContext null
                }

                // Create response for immediate use
                val response = WebResourceResponse(
                        mimeType,
                        encoding,
                        ByteArrayInputStream(responseBytes)
                    )

                // Cache the response
                val cacheEntry = CacheEntry(
                    response = WebResourceResponse(
                        mimeType,
                        encoding,
                        ByteArrayInputStream(responseBytes.copyOf())
                    ),
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
                            lastModified = lastModified
                        ))
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "✅ Successfully cached response for: $url")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error saving to disk cache for URL: $url: ${e.message}")
                    }
                }

                return@withContext response
            }
            return@withContext null
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching resource: ${e.message}")
            if (BuildConfig.DEBUG) {
                e.printStackTrace()
            }
            return@withContext null
        } finally {
            connection?.disconnect()
        }
    }

    private data class CacheMetadata(
        val mimeType: String,
        val encoding: String,
        val eTag: String? = null,
        val lastModified: String? = null
    ) : Serializable

    private fun createResponseFromCache(cacheFile: File, metadata: CacheMetadata): WebResourceResponse {
        return WebResourceResponse(
            metadata.mimeType,
            metadata.encoding,
            BufferedInputStream(FileInputStream(cacheFile), BUFFER_SIZE)
        )
    }

    private fun generateCacheKey(url: String): String {
        try {
            val md = MessageDigest.getInstance("MD5")
            val digest = md.digest(url.toByteArray())
            return digest.joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Error generating cache key: ${e.message}")
            // Fallback to a simple hash code if MD5 fails
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