package io.yourname.androidproject.utils

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import android.webkit.WebView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

/**
 * File utilities for native bridge operations
 * Handles file operations, URI handling, and file metadata
 */
object FileUtils {
    
    private const val TAG = "FileUtils"
    
    /**
     * Get file size from URI
     * 
     * @param context The context
     * @param uri The file URI
     * @return File size in bytes, or 0 if unable to determine
     */
    fun getFileSize(context: Context, uri: Uri): Long {
        return try {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIndex != -1) {
                    cursor.moveToFirst()
                    cursor.getLong(sizeIndex)
                } else {
                    0L
                }
            } ?: 0L
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error getting file size", e)
            0L
        }
    }
    
    /**
     * Get file name from URI
     * 
     * @param context The context
     * @param uri The file URI
     * @return File name or "unknown_file" if unable to determine
     */
    fun getFileName(context: Context, uri: Uri): String {
        return try {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex != -1) {
                    cursor.moveToFirst()
                    cursor.getString(nameIndex) ?: "unknown_file"
                } else {
                    "unknown_file"
                }
            } ?: "unknown_file"
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error getting file name", e)
            "unknown_file"
        }
    }
    
    /**
     * Get display name from URI
     * Currently same as file name, but can be enhanced for better display
     * 
     * @param context The context
     * @param uri The file URI
     * @return Display name
     */
    fun getDisplayName(context: Context, uri: Uri): String {
        return getFileName(context, uri)
    }
    
    /**
     * Get MIME type from URI
     * 
     * @param context The context
     * @param uri The file URI
     * @return MIME type or "star/star" if unable to determine
     */
    fun getMimeType(context: Context, uri: Uri): String {
        return try {
            context.contentResolver.getType(uri) ?: run {
                // Fallback: try to detect from file extension
                val fileName = getFileName(context, uri)
                val extension = fileName.substringAfterLast(".", "")
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.lowercase()) ?: "*/*"
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error getting MIME type", e)
            "*/*"
        }
    }
    
    /**
     * Convert URI content to Base64 string
     * 
     * @param context The context
     * @param uri The file URI
     * @return Base64 encoded string or null if conversion fails
     */
    fun convertUriToBase64(context: Context, uri: Uri): String? {
        return try {
            BridgeUtils.logDebug(TAG, "Converting URI to base64: $uri")
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            val bytes = inputStream?.readBytes()
            inputStream?.close()

            if (bytes != null) {
                BridgeUtils.logDebug(TAG, "Successfully read ${bytes.size} bytes")
                Base64.encodeToString(bytes, Base64.NO_WRAP) // NO_WRAP to avoid newlines
            } else {
                BridgeUtils.logError(TAG, "Failed to read bytes from URI")
                null
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Base64 conversion error", e)
            null
        }
    }
    
    /**
     * Process selected file and create JSON data
     * 
     * @param context The context
     * @param webView The WebView for callbacks
     * @param uri The file URI
     * @throws IllegalArgumentException if file is too large
     * @throws Exception if processing fails
     */
    fun processSelectedFile(context: Context, webView: WebView, uri: Uri) {
        BridgeUtils.logDebug(TAG, "Processing selected file: $uri")

        // Get file size first
        val fileSize = getFileSize(context, uri)
        BridgeUtils.logDebug(TAG, "File size: ${BridgeUtils.formatFileSize(fileSize)}")

        // Check absolute size limit
        BridgeUtils.validateFileSize(fileSize, BridgeUtils.MAX_FILE_SIZE_BYTES, "file selection")

        // Get file metadata
        val fileName = getFileName(context, uri)
        val mimeType = getMimeType(context, uri)
        val displayName = getDisplayName(context, uri)

        BridgeUtils.logDebug(TAG, "File name: $fileName")
        BridgeUtils.logDebug(TAG, "Display name: $displayName")
        BridgeUtils.logDebug(TAG, "MIME type: $mimeType")

        // Check if file is small enough for base64 conversion
        if (fileSize <= BridgeUtils.BASE64_SIZE_LIMIT) {
            BridgeUtils.logDebug(TAG, "File is small enough for base64 conversion")

            // Convert to base64
            val base64Data = convertUriToBase64(context, uri)
                ?: throw Exception("Failed to convert file to base64")

            BridgeUtils.logDebug(TAG, "Base64 conversion successful")

            // Create file data JSON with base64
            val fileData = JSONObject().apply {
                put("fileName", fileName)
                put("displayName", displayName)
                put("fileUri", uri.toString())
                put("mimeType", mimeType)
                put("fileSize", fileSize)
                put("fileSizeMB", String.format("%.2f", fileSize / (1024.0 * 1024.0)))
                put("base64Data", base64Data)
                put("dataUrl", "data:$mimeType;base64,$base64Data")
            }

            BridgeUtils.notifyWebJson(webView, BridgeUtils.WebEvents.ON_FILE_PICKED, fileData)
        } else {
            // File is too large for base64 conversion
            val fileSizeFormatted = BridgeUtils.formatFileSize(fileSize)
            val maxSizeFormatted = BridgeUtils.formatFileSize(BridgeUtils.BASE64_SIZE_LIMIT)
            
            throw IllegalArgumentException(
                "File too large for preview. Maximum size for preview: $maxSizeFormatted (selected: $fileSizeFormatted). Please select a smaller file."
            )
        }
    }
    
    /**
     * Create an accessible file URL from URI
     * 
     * @param context The context
     * @param uri The original URI
     * @param fileName The file name
     * @return Accessible file URL
     */
    fun createAccessibleFileUrl(context: Context, uri: Uri, fileName: String): String {
        return try {
            // Create a temporary accessible file
            val tempDir = File(context.cacheDir, "accessible_files")
            if (!tempDir.exists()) {
                tempDir.mkdirs()
            }

            // Clean filename for filesystem
            val cleanFileName = fileName.replace("[^a-zA-Z0-9._-]".toRegex(), "_")
            val tempFile = File(tempDir, "temp_${System.currentTimeMillis()}_$cleanFileName")

            // Copy content to accessible location
            context.contentResolver.openInputStream(uri)?.use { inputStream ->
                FileOutputStream(tempFile).use { outputStream ->
                    inputStream.copyTo(outputStream)
                }
            }

            // Create FileProvider URI that WebView can access
            val accessibleUri = FileProvider.getUriForFile(
                context,
                BridgeUtils.FILE_PROVIDER_AUTHORITY,
                tempFile
            )

            BridgeUtils.logDebug(TAG, "Created accessible file: ${tempFile.absolutePath}")
            BridgeUtils.logDebug(TAG, "Accessible URI: $accessibleUri")

            accessibleUri.toString()
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error creating accessible file", e)
            // Fallback to original URI (might not work in WebView)
            uri.toString()
        }
    }
    
    /**
     * Clean up temporary files older than specified age
     * 
     * @param context The context
     * @param maxAgeMillis Maximum age in milliseconds (default: 24 hours)
     */
    fun cleanupTempFiles(context: Context, maxAgeMillis: Long = 24 * 60 * 60 * 1000L) {
        try {
            val tempDir = File(context.cacheDir, "accessible_files")
            if (tempDir.exists()) {
                val files = tempDir.listFiles()
                val currentTime = System.currentTimeMillis()

                files?.forEach { file ->
                    if (currentTime - file.lastModified() > maxAgeMillis) {
                        if (file.delete()) {
                            BridgeUtils.logDebug(TAG, "Cleaned up old temp file: ${file.name}")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error cleaning up temp files", e)
        }
    }
    
    /**
     * Create a temporary file with given name
     * 
     * @param context The context
     * @param fileName The desired file name
     * @param subDir Optional subdirectory name (default: "downloaded_files")
     * @return The created temporary file
     */
    fun createTempFile(context: Context, fileName: String, subDir: String = "downloaded_files"): File {
        val tempDir = File(context.cacheDir, subDir)
        if (!tempDir.exists()) {
            tempDir.mkdirs()
        }

        val cleanFileName = fileName.replace("[^a-zA-Z0-9._-]".toRegex(), "_")
        return File(tempDir, cleanFileName)
    }
    
    /**
     * Send file picker state update to web
     * 
     * @param webView The WebView instance
     * @param state The current state
     */
    fun sendFilePickStateUpdate(webView: WebView, state: String) {
        val stateJson = JSONObject().apply {
            put("state", state)
        }

        BridgeUtils.logDebug(TAG, "File picker state update: $state")
        BridgeUtils.notifyWebJson(webView, BridgeUtils.WebEvents.ON_FILE_PICK_STATE_UPDATE, stateJson)
    }
    
    /**
     * Convert URI to File (for selected files)
     * Creates a temporary copy of the file if needed
     * 
     * @param context The context
     * @param uri The file URI
     * @return File object or null if conversion fails
     */
    fun uriToFile(context: Context, uri: Uri): File? {
        return try {
            val fileName = getFileName(context, uri)
            val tempFile = File(context.cacheDir, "temp_${System.currentTimeMillis()}_$fileName")
            
            context.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(tempFile).use { output ->
                    input.copyTo(output)
                }
            }
            
            BridgeUtils.logDebug(TAG, "Successfully converted URI to file: ${tempFile.absolutePath}")
            tempFile
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Failed to convert URI to file", e)
            null
        }
    }
    
    /**
     * Detect MIME type from file path
     * 
     * @param filePath The file path
     * @return MIME type or "star/star" if unable to determine if unable to determine
     */
    fun detectMimeType(filePath: String): String {
        val extension = filePath.substringAfterLast(".", "")
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.lowercase()) ?: "*/*"
    }
}