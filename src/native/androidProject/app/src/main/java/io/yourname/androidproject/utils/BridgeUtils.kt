package io.yourname.androidproject.utils

import android.util.Log
import android.webkit.WebView
import io.yourname.androidproject.CatalystConstants
import org.json.JSONObject
import android.os.Looper

/**
 * Common utilities for native bridge operations
 * Handles web communication, error reporting, and shared constants
 */
object BridgeUtils {

    private const val TAG = "BridgeUtils"

    // File size limits (from CatalystConstants)
    const val MAX_FILE_SIZE_BYTES = CatalystConstants.FileTransport.FRAMEWORK_SERVER_SIZE_LIMIT
    const val MAX_FILE_SIZE_MB = CatalystConstants.FileTransport.FRAMEWORK_SERVER_SIZE_LIMIT_MB
    const val BASE64_SIZE_LIMIT = CatalystConstants.FileTransport.BASE64_SIZE_LIMIT
    const val BASE64_SIZE_LIMIT_MB = CatalystConstants.FileTransport.BASE64_SIZE_LIMIT_MB

    // File provider authority (from CatalystConstants)
    const val FILE_PROVIDER_AUTHORITY = CatalystConstants.FileProvider.AUTHORITY
    
    /**
     * Web events enum for JavaScript callbacks
     */
    enum class WebEvents(val eventName: String) {
        // Camera events
        ON_CAMERA_CAPTURE("ON_CAMERA_CAPTURE"),
        ON_CAMERA_ERROR("ON_CAMERA_ERROR"),
        CAMERA_PERMISSION_STATUS("CAMERA_PERMISSION_STATUS"),
        
        // Haptic feedback events
        HAPTIC_FEEDBACK("HAPTIC_FEEDBACK"),
        
        // Intent-related events
        ON_INTENT_SUCCESS("ON_INTENT_SUCCESS"),
        ON_INTENT_ERROR("ON_INTENT_ERROR"),
        ON_INTENT_CANCELLED("ON_INTENT_CANCELLED"),
        
        // File picker events
        ON_FILE_PICKED("ON_FILE_PICKED"),
        ON_FILE_PICK_ERROR("ON_FILE_PICK_ERROR"),
        ON_FILE_PICK_CANCELLED("ON_FILE_PICK_CANCELLED"),
        ON_FILE_PICK_STATE_UPDATE("ON_FILE_PICK_STATE_UPDATE"),
        
        // FrameworkServer events
        ON_FRAMEWORK_SERVER_READY("ON_FRAMEWORK_SERVER_READY"),
        ON_FRAMEWORK_SERVER_ERROR("ON_FRAMEWORK_SERVER_ERROR"),
        ON_FRAMEWORK_SERVER_STOPPED("ON_FRAMEWORK_SERVER_STOPPED"),
        
        // Device info events
        ON_DEVICE_INFO_SUCCESS("ON_DEVICE_INFO_SUCCESS"),
        ON_DEVICE_INFO_ERROR("ON_DEVICE_INFO_ERROR"),
        
        // Notification events
        NOTIFICATION_PERMISSION_STATUS("NOTIFICATION_PERMISSION_STATUS"),
        LOCAL_NOTIFICATION_SCHEDULED("LOCAL_NOTIFICATION_SCHEDULED"),
        LOCAL_NOTIFICATION_CANCELLED("LOCAL_NOTIFICATION_CANCELLED"),
        PUSH_NOTIFICATION_TOKEN("PUSH_NOTIFICATION_TOKEN"),
        NOTIFICATION_RECEIVED("NOTIFICATION_RECEIVED"),
        NOTIFICATION_ACTION_PERFORMED("NOTIFICATION_ACTION_PERFORMED"),
        NOTIFICATION_TAPPED("NOTIFICATION_TAPPED"),
        TOPIC_SUBSCRIPTION_RESULT("TOPIC_SUBSCRIPTION_RESULT"),
        SUBSCRIBED_TOPICS_RESULT("SUBSCRIBED_TOPICS_RESULT"),

        // Auth events
        ON_GOOGLE_SIGN_IN_SUCCESS("ON_GOOGLE_SIGN_IN_SUCCESS"),
        ON_GOOGLE_SIGN_IN_ERROR("ON_GOOGLE_SIGN_IN_ERROR"),
        ON_GOOGLE_SIGN_IN_CANCELLED("ON_GOOGLE_SIGN_IN_CANCELLED"),

        // Network events
        NETWORK_STATUS_CHANGED("NETWORK_STATUS_CHANGED"),
    }
    
    /**
     * Send a callback to the web layer
     * 
     * @param webView The WebView instance
     * @param event The web event to send
     * @param data The data to send (can be null)
     */
    fun notifyWeb(webView: WebView, event: WebEvents, data: String? = null) {
        // Ensure WebView interactions happen on the main thread
        if (Looper.myLooper() != Looper.getMainLooper()) {
            webView.post { notifyWeb(webView, event, data) }
            return
        }

        try {
            val safeData = data?.replace("'", "\\'") ?: ""
            val jsCode = if (data != null) {
                "window.WebBridge.callback('${event.eventName}', '$safeData')"
            } else {
                "window.WebBridge.callback('${event.eventName}', null)"
            }
            
            webView.evaluateJavascript(jsCode, null)
            Log.d(TAG, "✅ Web notification sent: ${event.eventName}")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to notify web: ${e.message}")
        }
    }
    
    /**
     * Send an error notification to the web layer
     * 
     * @param webView The WebView instance
     * @param event The error event to send
     * @param errorMessage The error message
     */
    fun notifyWebError(webView: WebView, event: WebEvents, errorMessage: String?) {
        val safeMessage = errorMessage ?: "Unknown error occurred"
        Log.e(TAG, "🚨 Error notification: ${event.eventName} - $safeMessage")
        notifyWeb(webView, event, safeMessage)
    }
    
    /**
     * Send a success notification to the web layer
     * 
     * @param webView The WebView instance
     * @param event The success event to send
     * @param successMessage The success message
     */
    fun notifyWebSuccess(webView: WebView, event: WebEvents, successMessage: String? = "SUCCESS") {
        Log.d(TAG, "🎉 Success notification: ${event.eventName} - $successMessage")
        notifyWeb(webView, event, successMessage)
    }
    
    /**
     * Send a JSON object to the web layer
     * 
     * @param webView The WebView instance
     * @param event The web event to send
     * @param jsonData The JSON object to send
     */
    fun notifyWebJson(webView: WebView, event: WebEvents, jsonData: JSONObject) {
        try {
            val jsonString = jsonData.toString().replace("'", "\\'")
            notifyWeb(webView, event, jsonString)
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to send JSON to web: ${e.message}")
            notifyWebError(webView, event, "Error processing data: ${e.message}")
        }
    }
    
    /**
     * Create a standardized error message
     * 
     * @param operation The operation that failed
     * @param originalError The original error message
     * @return Formatted error message
     */
    fun createErrorMessage(operation: String, originalError: String?): String {
        return "Failed to $operation: ${originalError ?: "Unknown error"}"
    }
    
    /**
     * Log a debug message (only in debug builds)
     * 
     * @param tag The log tag
     * @param message The message to log
     */
    fun logDebug(tag: String, message: String) {
        if (io.yourname.androidproject.BuildConfig.DEBUG) {
            Log.d(tag, message)
        }
    }
    
    /**
     * Log an error message
     * 
     * @param tag The log tag
     * @param message The message to log
     * @param throwable Optional throwable for stack trace
     */
    fun logError(tag: String, message: String, throwable: Throwable? = null) {
        if (throwable != null) {
            Log.e(tag, message, throwable)
        } else {
            Log.e(tag, message)
        }
    }
    
    /**
     * Safely execute a block of code with standardized error handling
     * 
     * @param webView The WebView instance for error reporting
     * @param errorEvent The event to send on error
     * @param operation Description of the operation being performed
     * @param block The code block to execute
     */
    inline fun safeExecute(
        webView: WebView,
        errorEvent: WebEvents,
        operation: String,
        block: () -> Unit
    ) {
        try {
            block()
        } catch (e: Exception) {
            val errorMessage = createErrorMessage(operation, e.message)
            logError("SafeExecute", errorMessage, e)
            notifyWebError(webView, errorEvent, errorMessage)
        }
    }
    
    /**
     * Format file size in human readable format
     * 
     * @param sizeInBytes File size in bytes
     * @return Formatted string (e.g., "2.5 MB")
     */
    fun formatFileSize(sizeInBytes: Long): String {
        return when {
            sizeInBytes < 1024 -> "$sizeInBytes B"
            sizeInBytes < 1024 * 1024 -> "${String.format("%.1f", sizeInBytes / 1024.0)} KB"
            sizeInBytes < 1024 * 1024 * 1024 -> "${String.format("%.1f", sizeInBytes / (1024.0 * 1024.0))} MB"
            else -> "${String.format("%.1f", sizeInBytes / (1024.0 * 1024.0 * 1024.0))} GB"
        }
    }
    
    /**
     * Validate file size against limits
     * 
     * @param fileSizeBytes The file size in bytes
     * @param maxSizeBytes The maximum allowed size in bytes
     * @param operation Description of the operation (for error messages)
     * @throws IllegalArgumentException if file is too large
     */
    fun validateFileSize(fileSizeBytes: Long, maxSizeBytes: Long, operation: String) {
        if (fileSizeBytes > maxSizeBytes) {
            val fileSize = formatFileSize(fileSizeBytes)
            val maxSize = formatFileSize(maxSizeBytes)
            throw IllegalArgumentException("File too large for $operation: $fileSize (max: $maxSize)")
        }
    }

    fun logInfo(tag: String, message: String) {
        Log.i(tag, message)
    }
    
    fun logWarning(tag: String, message: String) {
        Log.w(tag, message)
    }
}
