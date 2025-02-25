package com.example.myapplication

import android.content.Context
import android.util.Log
import android.util.LruCache
import android.webkit.WebResourceResponse
import kotlinx.coroutines.*
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class WebCacheManager(private val context: Context) {
    private val TAG = "WebCacheManager"
    private val cacheDir = File(context.cacheDir, "webview_cache")
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val BUFFER_SIZE = 32 * 1024 

    // Cache timing configurations
    private val maxAge = TimeUnit.HOURS.toMillis(24) // Time until content becomes stale
    private val staleWhileRevalidate = TimeUnit.HOURS.toMillis(1) // Additional time content can be served while revalidating

    // Track ongoing revalidations to prevent duplicate requests
    private val ongoingRevalidations = mutableSetOf<String>()

    // Memory cache
    private val memoryCache: LruCache<String, CacheEntry> = LruCache<String, CacheEntry>(
        (Runtime.getRuntime().maxMemory() / 1024 / 8).toInt()
    )

    init {
        cacheDir.mkdirs()
    }

    data class CacheEntry(
        val response: WebResourceResponse,
        val timestamp: Long = System.currentTimeMillis(),
        val eTag: String? = null,
        val lastModified: String? = null
    )

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
                            Log.d(TAG, "Serving fresh content from memory cache: $url")
                            return@withContext memoryCacheEntry.response
                        }
                        age <= maxAge + staleWhileRevalidate -> {
                            // Stale content, but within revalidate window
                            Log.d(TAG, "Serving stale content while revalidating: $url")
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
                Log.d(TAG, "❌ Cache miss, fetching fresh content: $url")
                fetchAndCacheResource(url, headers, cacheKey)
            } catch (e: Exception) {
                Log.e(TAG, "Error in getCachedResponse for URL: $url", e)
                null
            }
        }

    suspend fun cleanup() {
        withContext(Dispatchers.IO) {
            try {
                val currentTime = System.currentTimeMillis()
                val maxCacheSize = 100 * 1024 * 1024 // 100MB max cache size
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

                Log.d(TAG, "Cache cleanup completed. Current size: ${totalSize / 1024}KB")
            } catch (e: Exception) {
                Log.e(TAG, "Error during cache cleanup", e)
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
                        Log.d(TAG, "✅ Content revalidated, not modified: $url")
                    }
                    HttpURLConnection.HTTP_OK -> {
                        // Content changed, update cache
                        Log.d(TAG, "⚡ Content changed, updating cache: $url")
                        fetchAndCacheResource(url, headers, cacheKey)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error during revalidation for URL: $url", e)
            } finally {
                ongoingRevalidations.remove(cacheKey)
            }
        }
    }

    private fun updateCacheFileTimestamp(cacheKey: String) {
        val cacheFile = File(cacheDir, cacheKey)
        if (cacheFile.exists()) {
            cacheFile.setLastModified(System.currentTimeMillis())
            File(cacheDir, "${cacheKey}.meta").setLastModified(System.currentTimeMillis())
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
                        ByteArrayInputStream(responseBytes.clone())
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
                        Log.d(TAG, "✅ Successfully cached response for: $url")
                    } catch (e: Exception) {
                        Log.e(TAG, "Error saving to disk cache for URL: $url", e)
                    }
                }

                return@withContext response
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
        val md = MessageDigest.getInstance("MD5")
        val digest = md.digest(url.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
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
            Log.e(TAG, "Error validating response", e)
            false
        }
    }

    private fun saveMetadata(cacheKey: String, metadata: CacheMetadata) {
        val metadataFile = File(cacheDir, "${cacheKey}.meta")
        ObjectOutputStream(FileOutputStream(metadataFile)).use {
            it.writeObject(metadata)
        }
    }

    private fun loadMetadata(cacheKey: String): CacheMetadata {
        val metadataFile = File(cacheDir, "${cacheKey}.meta")
        return ObjectInputStream(FileInputStream(metadataFile)).use {
            it.readObject() as CacheMetadata
        }
    }
}
