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
    private val cacheExpiration = TimeUnit.HOURS.toMillis(24) // 24 hour cache

    // Memory cache
    private val memoryCache: LruCache<String, CacheEntry> = LruCache<String, CacheEntry>(
        (Runtime.getRuntime().maxMemory() / 1024 / 8).toInt() // Use 1/8th of available memory
    )

    init {
        cacheDir.mkdirs()
    }

    data class CacheEntry(
        val response: WebResourceResponse,
        val timestamp: Long = System.currentTimeMillis()
    )

    fun cleanup() {
        scope.launch {
            try {
                val currentTime = System.currentTimeMillis()
                // Clean memory cache
                val keysToRemove = mutableListOf<String>()
                for (key in memoryCache.snapshot().keys) {
                    memoryCache.get(key)?.let { entry ->
                        if (currentTime - entry.timestamp > cacheExpiration) {
                            keysToRemove.add(key)
                        }
                    }
                }
                keysToRemove.forEach { memoryCache.remove(it) }

                // Clean disk cache
                cacheDir.listFiles()?.forEach { file ->
                    if (currentTime - file.lastModified() > cacheExpiration) {
                        file.delete()
                        File(cacheDir, "${file.nameWithoutExtension}.meta").delete()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error during cleanup", e)
            }
        }
    }

    suspend fun getCachedResponse(url: String, headers: Map<String, String>): WebResourceResponse? =
        withContext(Dispatchers.IO) {
            try {
                val cacheKey = generateCacheKey(url)

                // Try memory cache first
                memoryCache.get(cacheKey)?.let { entry ->
                    if (!isCacheExpired(entry.timestamp)) {
                        Log.d(TAG, "✅ Memory cache hit for: $url")
                        return@withContext entry.response
                    } else {
                        memoryCache.remove(cacheKey)
                    }
                }

                // Try disk cache
                val cacheFile = File(cacheDir, cacheKey)
                if (cacheFile.exists() && !isCacheExpired(cacheFile.lastModified())) {
                    try {
                        val metadata = loadMetadata(cacheKey)
                        val response = WebResourceResponse(
                            metadata.mimeType,
                            metadata.encoding,
                            BufferedInputStream(FileInputStream(cacheFile))
                        )
                        // Add to memory cache
                        memoryCache.put(cacheKey, CacheEntry(response))
                        Log.d(TAG, "✅ Disk cache hit for: $url")
                        return@withContext response
                    } catch (e: Exception) {
                        Log.e(TAG, "Error reading from disk cache", e)
                        cacheFile.delete() // Delete corrupted cache file
                        File(cacheDir, "${cacheKey}.meta").delete()
                    }
                }

                // If not in cache, fetch and store
                Log.d(TAG, "❌ Cache miss for: $url")
                fetchAndCacheResource(url, headers, cacheKey)
            } catch (e: Exception) {
                Log.e(TAG, "Error in getCachedResponse for URL: $url", e)
                null
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

            connection.connectTimeout = 15000 // 15 seconds
            connection.readTimeout = 15000 // 15 seconds
            connection.connect()

            val responseCode = connection.responseCode
            Log.d(TAG, "Response code for $url: $responseCode")

            if (responseCode == HttpURLConnection.HTTP_OK) {
                val mimeType = connection.contentType ?: "application/octet-stream"
                val encoding = connection.contentEncoding ?: "utf-8"

                // Read the response into memory
                val responseBytes = connection.inputStream.use { it.readBytes() }
                if (responseBytes.isEmpty()) {
                    Log.e(TAG, "Empty response received for $url")
                    return@withContext null
                }

                // Create WebResourceResponse for immediate use
                val response = WebResourceResponse(
                    mimeType,
                    encoding,
                    ByteArrayInputStream(responseBytes)
                )

                // Cache only if response is valid
                if (isValidResponse(mimeType, responseBytes)) {
                    // Save to memory cache
                    memoryCache.put(cacheKey, CacheEntry(
                        WebResourceResponse(
                            mimeType,
                            encoding,
                            ByteArrayInputStream(responseBytes.clone())
                        )
                    ))

                    // Save to disk cache asynchronously
                    scope.launch {
                        try {
                            val cacheFile = File(cacheDir, cacheKey)
                            FileOutputStream(cacheFile).use { fileOut ->
                                fileOut.write(responseBytes)
                            }
                            saveMetadata(cacheKey, CacheMetadata(mimeType, encoding))
                            Log.d(TAG, "✅ Successfully cached response for: $url")
                        } catch (e: Exception) {
                            Log.e(TAG, "Error saving to disk cache for URL: $url", e)
                        }
                    }
                } else {
                    Log.d(TAG, "⚠️ Invalid response not cached for: $url")
                }

                return@withContext response
            } else {
                Log.e(TAG, "HTTP Error $responseCode for URL: $url")
                return@withContext null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching resource for URL: $url", e)
            return@withContext null
        } finally {
            connection?.disconnect()
        }
    }

    private fun isValidResponse(mimeType: String, responseBytes: ByteArray): Boolean {
        return try {
            // Check if response is not empty
            if (responseBytes.isEmpty()) return false

            // Check if mime type is valid
            if (mimeType.isEmpty()) return false

            // For text-based responses, check if it's valid text
            if (mimeType.startsWith("text/") ||
                mimeType.contains("json") ||
                mimeType.contains("javascript")) {
                val content = String(responseBytes)
                if (content.isBlank()) return false
            }

            true
        } catch (e: Exception) {
            Log.e(TAG, "Error validating response", e)
            false
        }
    }

    private fun generateCacheKey(url: String): String {
        val md = MessageDigest.getInstance("MD5")
        val digest = md.digest(url.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun isCacheExpired(timestamp: Long): Boolean {
        return System.currentTimeMillis() - timestamp > cacheExpiration
    }

    private data class CacheMetadata(
        val mimeType: String,
        val encoding: String
    ) : Serializable

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