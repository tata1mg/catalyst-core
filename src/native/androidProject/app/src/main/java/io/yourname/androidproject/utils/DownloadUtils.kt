package io.yourname.androidproject.utils

import android.content.Context
import android.webkit.WebView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URL
import android.os.Handler
import android.os.Looper
import io.yourname.androidproject.URLWhitelistManager

/**
 * Download utilities for native bridge operations  
 * Handles network downloads and temporary file management
 */
object DownloadUtils {
    
    private const val TAG = "DownloadUtils"
    
    /**
     * Download a file from URL and save to temporary location
     * 
     * @param context The context
     * @param fileUrl The URL to download
     * @param fileName Optional custom filename
     * @return Downloaded file
     * @throws IOException if download fails
     * @throws Exception if URL is invalid
     */
    suspend fun downloadFile(
        context: Context, 
        fileUrl: String, 
        fileName: String? = null
    ): File = withContext(Dispatchers.IO) {
        BridgeUtils.logDebug(TAG, "Starting download for: $fileUrl")

        val url = URL(fileUrl)
        val finalFileName = fileName ?: extractFileNameFromUrl(fileUrl)
        val tempFile = FileUtils.createTempFile(context, finalFileName, "downloaded_files")

        BridgeUtils.logDebug(TAG, "Downloading to: ${tempFile.absolutePath}")

        // Download file
        url.openStream().use { input ->
            FileOutputStream(tempFile).use { output ->
                input.copyTo(output)
            }
        }

        BridgeUtils.logDebug(TAG, "Download completed: ${BridgeUtils.formatFileSize(tempFile.length())}")
        tempFile
    }
    
    /**
     * Download file and notify web layer with progress
     * 
     * @param context The context
     * @param webView The WebView for callbacks
     * @param fileUrl The URL to download
     * @param mimeType Optional MIME type override
     * @param onSuccess Callback when download succeeds
     * @param onError Callback when download fails
     */
    suspend fun downloadFileWithCallback(
        context: Context,
        webView: WebView,
        fileUrl: String,
        mimeType: String? = null,
        allowedUrls: List<String> = emptyList(),
        accessControlEnabled: Boolean = true,
        onSuccess: (File, String) -> Unit,
        onError: ((String) -> Unit)? = null
    ) {
        try {
            // Validate URL
            if (!isValidUrl(fileUrl)) {
                throw IllegalArgumentException("Invalid URL format: $fileUrl")
            }

            // Whitelist validation for remote URLs
            if (!URLWhitelistManager.isUrlAllowed(fileUrl)) {
                val errorMessage = "Unable to process request. URL violates whitelisting protocols"
                BridgeUtils.logError(TAG, "File URL blocked by access control: $fileUrl")
                throw SecurityException(errorMessage)
            } else if (URLWhitelistManager.isAccessControlEnabled()) {
                BridgeUtils.logDebug(TAG, "✅ File URL passed whitelist check: $fileUrl")
            } else {
                BridgeUtils.logDebug(TAG, "⚙️ Access control disabled; skipping whitelist checks for download")
            }

            // Download the file
            val downloadedFile = downloadFile(context, fileUrl)
            
            // Detect MIME type if not provided
            val detectedMimeType = mimeType ?: FileUtils.detectMimeType(downloadedFile.absolutePath)
            
            BridgeUtils.logDebug(TAG, "Download successful, MIME type: $detectedMimeType")
            
            // Call success callback
            onSuccess(downloadedFile, detectedMimeType)
            
        } catch (e: IOException) {
            val errorMessage = "Failed to download file: ${e.message}"
            BridgeUtils.logError(TAG, errorMessage, e)

            onError?.invoke(errorMessage) ?: run {
                // WebView methods must be called on Main thread
                Handler(Looper.getMainLooper()).post {
                    BridgeUtils.notifyWebError(
                        webView,
                        BridgeUtils.WebEvents.ON_INTENT_ERROR,
                        errorMessage
                    )
                }
            }
        } catch (e: Exception) {
            val errorMessage = "Error downloading file: ${e.message}"
            BridgeUtils.logError(TAG, errorMessage, e)

            onError?.invoke(errorMessage) ?: run {
                // WebView methods must be called on Main thread
                Handler(Looper.getMainLooper()).post {
                    BridgeUtils.notifyWebError(
                        webView,
                        BridgeUtils.WebEvents.ON_INTENT_ERROR,
                        errorMessage
                    )
                }
            }
        }
    }
    
    /**
     * Extract filename from URL
     * 
     * @param url The URL to extract filename from
     * @return Extracted filename or "downloaded_file" as fallback
     */
    fun extractFileNameFromUrl(url: String): String {
        return try {
            val fileName = url.substringAfterLast("/").substringBefore("?")
            if (fileName.isBlank()) "downloaded_file" else fileName
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error extracting filename from URL", e)
            "downloaded_file"
        }
    }
    
    /**
     * Validate if URL is properly formatted and supported
     * 
     * @param url The URL to validate
     * @return true if URL is valid
     */
    fun isValidUrl(url: String): Boolean {
        return try {
            when {
                url.isBlank() -> false
                !url.startsWith("http://") && !url.startsWith("https://") -> false
                else -> {
                    URL(url) // This will throw if URL is malformed
                    true
                }
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Invalid URL: $url", e)
            false
        }
    }
    
    /**
     * Get file size from URL without downloading (HEAD request)
     * Note: This is a basic implementation, could be enhanced for better efficiency
     * 
     * @param fileUrl The URL to check
     * @return File size in bytes, or -1 if unable to determine
     */
    suspend fun getRemoteFileSize(fileUrl: String): Long = withContext(Dispatchers.IO) {
        try {
            val connection = URL(fileUrl).openConnection()
            connection.setRequestProperty("User-Agent", "Android App")
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            
            val contentLength = connection.contentLengthLong
            connection.inputStream.close()
            
            contentLength
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error getting remote file size", e)
            -1L
        }
    }
    
    /**
     * Clean up downloaded files older than specified age
     * 
     * @param context The context
     * @param maxAgeMillis Maximum age in milliseconds (default: 3 days)
     */
    fun cleanupDownloadedFiles(context: Context, maxAgeMillis: Long = 3 * 24 * 60 * 60 * 1000L) {
        try {
            val downloadDir = File(context.cacheDir, "downloaded_files")
            if (downloadDir.exists()) {
                val files = downloadDir.listFiles()
                val currentTime = System.currentTimeMillis()

                files?.forEach { file ->
                    if (currentTime - file.lastModified() > maxAgeMillis) {
                        if (file.delete()) {
                            BridgeUtils.logDebug(TAG, "Cleaned up old downloaded file: ${file.name}")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error cleaning up downloaded files", e)
        }
    }
    
    /**
     * Check if device has sufficient storage for download
     * 
     * @param context The context
     * @param requiredBytes Required storage in bytes
     * @return true if sufficient storage available
     */
    fun hasSufficientStorage(context: Context, requiredBytes: Long): Boolean {
        return try {
            val availableBytes = context.cacheDir.freeSpace
            availableBytes >= requiredBytes * 1.2 // Add 20% buffer
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error checking storage", e)
            false // Assume insufficient storage on error
        }
    }
    
    /**
     * Validate download requirements before starting
     * 
     * @param context The context
     * @param fileUrl The URL to download
     * @param maxFileSize Maximum allowed file size in bytes
     * @throws IllegalArgumentException if requirements not met
     */
    suspend fun validateDownloadRequirements(
        context: Context,
        fileUrl: String,
        maxFileSize: Long = BridgeUtils.MAX_FILE_SIZE_BYTES
    ) {
        // Validate URL format
        if (!isValidUrl(fileUrl)) {
            throw IllegalArgumentException("Invalid or unsupported URL format")
        }
        
        // Check remote file size (if available)
        val remoteSize = getRemoteFileSize(fileUrl)
        if (remoteSize > 0 && remoteSize > maxFileSize) {
            throw IllegalArgumentException(
                "File too large: ${BridgeUtils.formatFileSize(remoteSize)} " +
                "(max: ${BridgeUtils.formatFileSize(maxFileSize)})"
            )
        }
        
        // Check available storage (if file size is known)
        if (remoteSize > 0 && !hasSufficientStorage(context, remoteSize)) {
            throw IllegalArgumentException("Insufficient storage space for download")
        }
    }
}
