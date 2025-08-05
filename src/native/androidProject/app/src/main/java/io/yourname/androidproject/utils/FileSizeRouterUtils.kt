package io.yourname.androidproject.utils

import android.content.Context
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.WebView
import java.io.File

/**
 * FileSizeRouterUtils - Intelligent routing for file operations based on size and type
 * 
 * This utility implements the tri-transport architecture decision logic for handling
 * files of different sizes using appropriate transport mechanisms:
 * - Bridge Transport: ≤2MB files (base64 conversion)
 * - Framework Server Transport: >2MB files (localhost URL serving)
 * - Content Provider Fallback: When server unavailable
 * 
 * Key Features:
 * - Automatic size-based transport selection
 * - MIME type detection and validation
 * - File accessibility verification
 * - Error handling and fallback mechanisms
 */
object FileSizeRouterUtils {
    private const val TAG = "FileSizeRouter"
    
    // Size thresholds for transport selection
    const val MAX_BRIDGE_SIZE = 2 * 1024 * 1024 // 2MB
    const val MAX_SERVER_SIZE = 100 * 1024 * 1024 // 100MB
    
    // Transport types
    enum class TransportType {
        BRIDGE_BASE64,          // Direct base64 via bridge (≤2MB)
        FRAMEWORK_SERVER,       // Localhost URL via framework server (>2MB)
        CONTENT_PROVIDER,       // Native content provider fallback
        UNSUPPORTED            // File too large or inaccessible
    }
    
    data class FileRoutingDecision(
        val transportType: TransportType,
        val file: File,
        val fileName: String,
        val mimeType: String,
        val fileSize: Long,
        val reason: String,
        val canProceed: Boolean = true,
        val errorMessage: String? = null
    )
    
    data class FileProcessingResult(
        val success: Boolean,
        val fileName: String,
        val fileSrc: String?,          // Base64 data URI or localhost URL
        val filePath: String,          // Original file path
        val fileSize: Long,
        val mimeType: String,
        val transportUsed: TransportType,
        val error: String? = null
    )
    
    /**
     * Determine the appropriate transport for a file based on size and accessibility
     * @param file File to analyze
     * @return FileRoutingDecision with recommended transport and details
     */
    fun determineTransport(file: File): FileRoutingDecision {
        Log.d(TAG, "Determining transport for file: ${file.absolutePath}")
        
        // Check if file exists and is readable
        if (!file.exists()) {
            Log.e(TAG, "File does not exist: ${file.absolutePath}")
            return FileRoutingDecision(
                transportType = TransportType.UNSUPPORTED,
                file = file,
                fileName = file.name,
                mimeType = "application/octet-stream",
                fileSize = 0,
                reason = "File does not exist",
                canProceed = false,
                errorMessage = "Selected file no longer exists"
            )
        }
        
        if (!file.canRead()) {
            Log.e(TAG, "File is not readable: ${file.absolutePath}")
            return FileRoutingDecision(
                transportType = TransportType.UNSUPPORTED,
                file = file,
                fileName = file.name,
                mimeType = "application/octet-stream",
                fileSize = file.length(),
                reason = "File is not readable",
                canProceed = false,
                errorMessage = "Permission denied - cannot access file"
            )
        }
        
        val fileSize = file.length()
        val fileName = file.name
        val mimeType = getMimeType(file)
        
        Log.d(TAG, "File analysis: $fileName, size: ${fileSize}B (${formatFileSize(fileSize)}), type: $mimeType")
        
        // Determine transport based on file size
        val (transportType, reason) = when {
            fileSize <= MAX_BRIDGE_SIZE -> {
                TransportType.BRIDGE_BASE64 to "File size ≤2MB, using direct bridge with base64 encoding"
            }
            fileSize <= MAX_SERVER_SIZE -> {
                if (FrameworkServerUtils.isRunning()) {
                    TransportType.FRAMEWORK_SERVER to "File size >2MB, using framework server for URL-based access"
                } else {
                    TransportType.CONTENT_PROVIDER to "File size >2MB but framework server unavailable, using content provider fallback"
                }
            }
            else -> {
                TransportType.UNSUPPORTED to "File size >100MB, exceeds maximum supported size"
            }
        }
        
        val canProceed = transportType != TransportType.UNSUPPORTED
        val errorMessage = if (!canProceed) {
            when (transportType) {
                TransportType.UNSUPPORTED -> "File is too large (${formatFileSize(fileSize)}). Maximum supported size is ${formatFileSize(MAX_SERVER_SIZE.toLong())}"
                else -> null
            }
        } else null
        
        Log.i(TAG, "Transport decision for $fileName: $transportType - $reason")
        
        return FileRoutingDecision(
            transportType = transportType,
            file = file,
            fileName = fileName,
            mimeType = mimeType,
            fileSize = fileSize,
            reason = reason,
            canProceed = canProceed,
            errorMessage = errorMessage
        )
    }
    
    /**
     * Process a file using the determined transport method
     * @param context Android context
     * @param webView WebView for notifications
     * @param decision FileRoutingDecision from determineTransport
     * @return FileProcessingResult with the processed file data
     */
    fun processFile(context: Context, webView: WebView, decision: FileRoutingDecision): FileProcessingResult {
        Log.d(TAG, "Processing file with transport: ${decision.transportType}")
        
        if (!decision.canProceed) {
            Log.e(TAG, "Cannot process file: ${decision.errorMessage}")
            return FileProcessingResult(
                success = false,
                fileName = decision.fileName,
                fileSrc = null,
                filePath = decision.file.absolutePath,
                fileSize = decision.fileSize,
                mimeType = decision.mimeType,
                transportUsed = decision.transportType,
                error = decision.errorMessage
            )
        }
        
        return when (decision.transportType) {
            TransportType.BRIDGE_BASE64 -> processViaBridge(context, decision)
            TransportType.FRAMEWORK_SERVER -> processViaFrameworkServer(decision)
            TransportType.CONTENT_PROVIDER -> processViaContentProvider(context, decision)
            TransportType.UNSUPPORTED -> FileProcessingResult(
                success = false,
                fileName = decision.fileName,
                fileSrc = null,
                filePath = decision.file.absolutePath,
                fileSize = decision.fileSize,
                mimeType = decision.mimeType,
                transportUsed = decision.transportType,
                error = "Transport not supported"
            )
        }
    }
    
    /**
     * Get appropriate MIME type for a file
     * @param file File to analyze
     * @return MIME type string
     */
    fun getMimeType(file: File): String {
        val extension = file.extension.lowercase()
        val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
        
        return mimeType ?: when (extension) {
            "pdf" -> "application/pdf"
            "doc" -> "application/msword"
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "xls" -> "application/vnd.ms-excel"
            "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            "ppt" -> "application/vnd.ms-powerpoint"
            "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            else -> "application/octet-stream"
        }
    }
    
    /**
     * Format file size in human-readable format
     * @param bytes File size in bytes
     * @return Formatted string (e.g., "1.5 MB")
     */
    fun formatFileSize(bytes: Long): String {
        val units = arrayOf("B", "KB", "MB", "GB")
        var size = bytes.toDouble()
        var unitIndex = 0
        
        while (size >= 1024 && unitIndex < units.size - 1) {
            size /= 1024
            unitIndex++
        }
        
        return if (unitIndex == 0) {
            "${size.toInt()} ${units[unitIndex]}"
        } else {
            "%.1f ${units[unitIndex]}".format(size)
        }
    }
    
    // Private processing methods for each transport type
    
    private fun processViaBridge(context: Context, decision: FileRoutingDecision): FileProcessingResult {
        Log.d(TAG, "Processing via bridge (base64): ${decision.fileName}")
        
        return try {
            val base64Data = FileUtils.convertUriToBase64(context, android.net.Uri.fromFile(decision.file))
            
            if (base64Data != null) {
                val dataUri = "data:${decision.mimeType};base64,$base64Data"
                
                Log.i(TAG, "Successfully converted file to base64: ${decision.fileName} (${decision.fileSize} bytes)")
                
                FileProcessingResult(
                    success = true,
                    fileName = decision.fileName,
                    fileSrc = dataUri,
                    filePath = decision.file.absolutePath,
                    fileSize = decision.fileSize,
                    mimeType = decision.mimeType,
                    transportUsed = TransportType.BRIDGE_BASE64
                )
            } else {
                throw Exception("Failed to convert file to base64")
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to process file via bridge", e)
            FileProcessingResult(
                success = false,
                fileName = decision.fileName,
                fileSrc = null,
                filePath = decision.file.absolutePath,
                fileSize = decision.fileSize,
                mimeType = decision.mimeType,
                transportUsed = TransportType.BRIDGE_BASE64,
                error = "Failed to convert file to base64: ${e.message}"
            )
        }
    }
    
    private fun processViaFrameworkServer(decision: FileRoutingDecision): FileProcessingResult {
        Log.d(TAG, "Processing via framework server: ${decision.fileName}")
        
        return try {
            val serverUrl = FrameworkServerUtils.copyAndServeFile(
                decision.file,
                decision.fileName,
                decision.mimeType
            )
            
            if (serverUrl != null) {
                Log.i(TAG, "Successfully added file to framework server: ${decision.fileName} -> $serverUrl")
                
                FileProcessingResult(
                    success = true,
                    fileName = decision.fileName,
                    fileSrc = serverUrl,
                    filePath = decision.file.absolutePath,
                    fileSize = decision.fileSize,
                    mimeType = decision.mimeType,
                    transportUsed = TransportType.FRAMEWORK_SERVER
                )
            } else {
                throw Exception("Framework server failed to serve file")
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to process file via framework server", e)
            FileProcessingResult(
                success = false,
                fileName = decision.fileName,
                fileSrc = null,
                filePath = decision.file.absolutePath,
                fileSize = decision.fileSize,
                mimeType = decision.mimeType,
                transportUsed = TransportType.FRAMEWORK_SERVER,
                error = "Framework server error: ${e.message}"
            )
        }
    }
    
    private fun processViaContentProvider(context: Context, decision: FileRoutingDecision): FileProcessingResult {
        Log.d(TAG, "Processing via content provider: ${decision.fileName}")
        
        return try {
            // Check if context is an Activity
            if (context !is android.app.Activity) {
                throw IllegalArgumentException("Content provider requires Activity context, got: ${context::class.simpleName}")
            }
            
            // Use existing IntentUtils for content provider operations
            val contentUri = IntentUtils.createFileProviderUri(context, decision.file)
            
            Log.i(TAG, "Successfully created content provider URI: ${decision.fileName} -> $contentUri")
            
            FileProcessingResult(
                success = true,
                fileName = decision.fileName,
                fileSrc = contentUri.toString(),
                filePath = decision.file.absolutePath,
                fileSize = decision.fileSize,
                mimeType = decision.mimeType,
                transportUsed = TransportType.CONTENT_PROVIDER
            )
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to process file via content provider", e)
            FileProcessingResult(
                success = false,
                fileName = decision.fileName,
                fileSrc = null,
                filePath = decision.file.absolutePath,
                fileSize = decision.fileSize,
                mimeType = decision.mimeType,
                transportUsed = TransportType.CONTENT_PROVIDER,
                error = "Content provider error: ${e.message}"
            )
        }
    }
}