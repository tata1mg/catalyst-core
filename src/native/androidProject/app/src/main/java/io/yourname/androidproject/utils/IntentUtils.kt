package io.yourname.androidproject.utils

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import androidx.core.content.FileProvider
import java.io.File

/**
 * Intent utilities for native bridge operations
 * Handles system intents for opening files with external applications
 */
object IntentUtils {
    
    private const val TAG = "IntentUtils"
    
    /**
     * Open file with system intent (external app)
     * 
     * @param activity The activity context
     * @param webView The WebView for callbacks
     * @param file The file to open
     * @param mimeType The MIME type of the file
     */
    fun openFileWithSystemIntent(activity: Activity, webView: WebView, file: File, mimeType: String) {
        BridgeUtils.safeExecute(
            webView,
            BridgeUtils.WebEvents.ON_INTENT_ERROR,
            "open file with external app"
        ) {
            BridgeUtils.logDebug(TAG, "Creating intent for file: ${file.name}")
            BridgeUtils.logDebug(TAG, "MIME type: $mimeType")

            val uri = FileProvider.getUriForFile(
                activity,
                BridgeUtils.FILE_PROVIDER_AUTHORITY,
                file
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
            }

            // Check if any apps can handle this intent
            if (canHandleIntent(activity, intent)) {
                val chooser = Intent.createChooser(intent, "Open file with...")
                activity.startActivity(chooser)

                BridgeUtils.logDebug(TAG, "Intent launched successfully")
                BridgeUtils.notifyWebSuccess(
                    webView,
                    BridgeUtils.WebEvents.ON_INTENT_SUCCESS,
                    "File opened successfully"
                )
            } else {
                val errorMessage = "No apps available to open this file type ($mimeType)"
                BridgeUtils.logError(TAG, errorMessage)
                BridgeUtils.notifyWebError(
                    webView,
                    BridgeUtils.WebEvents.ON_INTENT_ERROR,
                    errorMessage
                )
            }
        }
    }
    
    /**
     * Check if any apps can handle the given intent
     * 
     * @param activity The activity context
     * @param intent The intent to check
     * @return true if at least one app can handle the intent
     */
    fun canHandleIntent(activity: Activity, intent: Intent): Boolean {
        return try {
            val resolveInfo = activity.packageManager.queryIntentActivities(intent, 0)
            resolveInfo.isNotEmpty()
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error checking intent resolution", e)
            false
        }
    }
    
    /**
     * Get list of apps that can handle specific MIME type
     * 
     * @param activity The activity context
     * @param mimeType The MIME type to check
     * @return List of app names that can handle the MIME type
     */
    fun getAppsForMimeType(activity: Activity, mimeType: String): List<String> {
        return try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                type = mimeType
            }
            
            val resolveInfos = activity.packageManager.queryIntentActivities(intent, 0)
            resolveInfos.map { resolveInfo ->
                resolveInfo.loadLabel(activity.packageManager).toString()
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error getting apps for MIME type", e)
            emptyList()
        }
    }
    
    /**
     * Create a file picker intent
     *
     */
    fun createFilePickerIntent(mimeType: String = "*/*", allowMultiple: Boolean = false): Intent {
        // Handle comma-separated MIME types (e.g., "application/pdf,image/*")
        if (mimeType.contains(",")) {
            BridgeUtils.logDebug(TAG, "Processing comma-separated MIME types: $mimeType")
            val mimeTypes = mimeType.split(",").map { it.trim() }.filter { it.isNotEmpty() }

            return Intent(Intent.ACTION_GET_CONTENT).apply {
                // Set the primary type to */* to allow all types initially
                type = "*/*"
                addCategory(Intent.CATEGORY_OPENABLE)

                // Use EXTRA_MIME_TYPES to specify the allowed MIME types
                if (mimeTypes.size > 1) {
                    putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
                    BridgeUtils.logDebug(TAG, "Using EXTRA_MIME_TYPES with ${mimeTypes.size} types: ${mimeTypes.joinToString(", ")}")
                } else if (mimeTypes.size == 1) {
                    // If only one MIME type after parsing, use it directly
                    type = mimeTypes[0]
                    BridgeUtils.logDebug(TAG, "Using single MIME type: ${mimeTypes[0]}")
                }

                if (allowMultiple) {
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
            }
        }

        // Single MIME type (original behavior)
        return Intent(Intent.ACTION_GET_CONTENT).apply {
            type = mimeType
            addCategory(Intent.CATEGORY_OPENABLE)
            if (allowMultiple) {
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        }
    }
    
    /**
     * Parse intent parameters from string format
     * Expected format: "fileUrl|mimeType" or just "fileUrl"
     * 
     * @param params The parameter string
     * @return Pair of (fileUrl, mimeType) where mimeType can be null
     * @throws IllegalArgumentException if params format is invalid
     */
    fun parseIntentParams(params: String?): Pair<String, String?> {
        if (params.isNullOrBlank()) {
            throw IllegalArgumentException("Intent parameters cannot be empty")
        }

        val parts = params.split("|", limit = 2)
        val fileUrl = parts[0].trim()
        val mimeType = if (parts.size > 1) parts[1].trim().takeIf { it.isNotEmpty() } else null

        if (fileUrl.isEmpty()) {
            throw IllegalArgumentException("File URL cannot be empty")
        }

        return Pair(fileUrl, mimeType)
    }
    
    /**
     * Validate file URL for intent operations
     * 
     * @param fileUrl The file URL to validate
     * @throws IllegalArgumentException if URL is invalid
     */
    fun validateFileUrl(fileUrl: String) {
        when {
            fileUrl.isBlank() -> throw IllegalArgumentException("File URL cannot be empty")
            !fileUrl.startsWith("http://") && !fileUrl.startsWith("https://") -> 
                throw IllegalArgumentException("Only remote URLs (http/https) are supported")
        }
    }
    
    /**
     * Create sharing intent for file
     * 
     * @param activity The activity context
     * @param file The file to share
     * @param mimeType The MIME type of the file
     * @param title Optional title for the share dialog
     * @return Configured sharing Intent
     */
    fun createShareIntent(activity: Activity, file: File, mimeType: String, title: String? = null): Intent {
        val uri = FileProvider.getUriForFile(
            activity,
            BridgeUtils.FILE_PROVIDER_AUTHORITY,
            file
        )

        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
        }

        return Intent.createChooser(shareIntent, title ?: "Share file")
    }
    
    /**
     * Open file with specific app package
     * 
     * @param activity The activity context
     * @param webView The WebView for callbacks
     * @param file The file to open
     * @param mimeType The MIME type of the file
     * @param packageName The target app package name
     */
    fun openFileWithSpecificApp(
        activity: Activity, 
        webView: WebView, 
        file: File, 
        mimeType: String, 
        packageName: String
    ) {
        BridgeUtils.safeExecute(
            webView,
            BridgeUtils.WebEvents.ON_INTENT_ERROR,
            "open file with specific app"
        ) {
            val uri = FileProvider.getUriForFile(
                activity,
                BridgeUtils.FILE_PROVIDER_AUTHORITY,
                file
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
                setPackage(packageName)
            }

            if (canHandleIntent(activity, intent)) {
                activity.startActivity(intent)
                BridgeUtils.notifyWebSuccess(
                    webView,
                    BridgeUtils.WebEvents.ON_INTENT_SUCCESS,
                    "File opened with $packageName"
                )
            } else {
                BridgeUtils.notifyWebError(
                    webView,
                    BridgeUtils.WebEvents.ON_INTENT_ERROR,
                    "App $packageName cannot handle this file type"
                )
            }
        }
    }
    
    /**
     * Get default app for MIME type
     * 
     * @param activity The activity context
     * @param mimeType The MIME type
     * @return Package name of default app, or null if no default set
     */
    fun getDefaultAppForMimeType(activity: Activity, mimeType: String): String? {
        return try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                type = mimeType
            }
            
            val resolveInfo = activity.packageManager.resolveActivity(intent, 0)
            resolveInfo?.activityInfo?.packageName
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error getting default app", e)
            null
        }
    }
    
    /**
     * Create a file provider URI for the given file
     * 
     * @param activity The activity context
     * @param file The file to create URI for
     * @return Content URI for the file
     */
    fun createFileProviderUri(activity: Activity, file: File): Uri {
        return FileProvider.getUriForFile(
            activity,
            BridgeUtils.FILE_PROVIDER_AUTHORITY,
            file
        )
    }
}