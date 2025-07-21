package io.yourname.androidproject.utils

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Environment
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

/**
 * Camera utilities for native bridge operations
 * Handles camera permissions, file creation, and image processing
 */
object CameraUtils {
    
    private const val TAG = "CameraUtils"
    private const val CAMERA_PERMISSION = Manifest.permission.CAMERA
    
    /**
     * Check if camera permission is granted
     * 
     * @param activity The activity context
     * @return true if camera permission is granted
     */
    fun hasCameraPermission(activity: Activity): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            CAMERA_PERMISSION
        ) == PackageManager.PERMISSION_GRANTED
    }
    
    /**
     * Create a unique image file for camera capture
     * 
     * @param activity The activity context
     * @return Created image file
     * @throws Exception if file creation fails
     */
    fun createImageFile(activity: Activity): File {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val storageDir = activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES)

        // Ensure the directory exists
        storageDir?.mkdirs()

        return File.createTempFile(
            "JPEG_${timeStamp}_",
            ".jpg",
            storageDir
        ).apply {
            parentFile?.mkdirs()
        }
    }
    
    /**
     * Create FileProvider URI for camera capture
     * 
     * @param activity The activity context
     * @return URI for camera capture
     * @throws Exception if URI creation fails
     */
    fun createCameraUri(activity: Activity): Uri {
        val photoFile = createImageFile(activity)
        return FileProvider.getUriForFile(
            activity,
            BridgeUtils.FILE_PROVIDER_AUTHORITY,
            photoFile
        )
    }
    
    /**
     * Process camera capture result and notify web
     * 
     * @param activity The activity context
     * @param webView The WebView for callbacks
     * @param photoUri The URI of captured photo
     * @param success Whether capture was successful
     */
    fun processCameraResult(activity: Activity, webView: WebView, photoUri: Uri?, success: Boolean) {
        if (success && photoUri != null) {
            try {
                // In production version, we avoid sending full base64 image for performance
                // Instead, just send the image URI and do processing on the web side if needed
                val imageUrl = photoUri.toString()

                val json = JSONObject().apply {
                    put("imageUrl", imageUrl)
                    // Note: Removed base64 encoding for production - it's memory intensive
                    // If needed, can be added back with size checks
                }

                BridgeUtils.notifyWebJson(webView, BridgeUtils.WebEvents.ON_CAMERA_CAPTURE, json)
                BridgeUtils.logDebug(TAG, "Camera capture successful: $imageUrl")
                
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Error processing image", e)
                BridgeUtils.notifyWebError(
                    webView, 
                    BridgeUtils.WebEvents.ON_CAMERA_ERROR, 
                    "Error processing captured image: ${e.message}"
                )
            }
        } else {
            BridgeUtils.logError(TAG, "Camera capture failed or was cancelled")
            BridgeUtils.notifyWebError(
                webView,
                BridgeUtils.WebEvents.ON_CAMERA_ERROR,
                "Camera capture failed or was cancelled"
            )
        }
    }
    
    /**
     * Handle camera permission result
     * 
     * @param webView The WebView for callbacks
     * @param isGranted Whether permission was granted
     * @param onPermissionGranted Callback to execute if permission granted
     */
    fun handlePermissionResult(
        webView: WebView, 
        isGranted: Boolean, 
        onPermissionGranted: (() -> Unit)? = null
    ) {
        if (isGranted) {
            BridgeUtils.logDebug(TAG, "Camera permission granted")
            BridgeUtils.notifyWeb(
                webView,
                BridgeUtils.WebEvents.CAMERA_PERMISSION_STATUS,
                "GRANTED"
            )
            onPermissionGranted?.invoke()
        } else {
            BridgeUtils.logError(TAG, "Camera permission denied")
            BridgeUtils.notifyWeb(
                webView,
                BridgeUtils.WebEvents.CAMERA_PERMISSION_STATUS,
                "DENIED"
            )
        }
    }
    
    /**
     * Validate camera capture requirements
     * 
     * @param activity The activity context
     * @throws IllegalStateException if requirements not met
     */
    fun validateCameraRequirements(activity: Activity) {
        // Check if device has camera
        if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            throw IllegalStateException("Device does not have a camera")
        }
        
        // Check external storage availability
        val storageState = Environment.getExternalStorageState()
        if (storageState != Environment.MEDIA_MOUNTED) {
            throw IllegalStateException("External storage not available")
        }
    }
    
    /**
     * Get camera permission status as string
     * 
     * @param activity The activity context
     * @return Permission status string
     */
    fun getPermissionStatus(activity: Activity): String {
        return if (hasCameraPermission(activity)) {
            "GRANTED"
        } else {
            when {
                // Check if permission was permanently denied (would need more context)
                // For now, we'll use a simple granted/denied approach
                ContextCompat.checkSelfPermission(activity, CAMERA_PERMISSION) == 
                    PackageManager.PERMISSION_DENIED -> "DENIED"
                else -> "NOT_DETERMINED"
            }
        }
    }
    
    /**
     * Cleanup old camera files
     * 
     * @param activity The activity context
     * @param maxAgeMillis Maximum age for files (default: 7 days)
     */
    fun cleanupOldCameraFiles(activity: Activity, maxAgeMillis: Long = 7 * 24 * 60 * 60 * 1000L) {
        try {
            val picturesDir = activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
            if (picturesDir?.exists() == true) {
                val files = picturesDir.listFiles { file -> 
                    file.name.startsWith("JPEG_") && file.name.endsWith(".jpg")
                }
                
                val currentTime = System.currentTimeMillis()
                files?.forEach { file ->
                    if (currentTime - file.lastModified() > maxAgeMillis) {
                        if (file.delete()) {
                            BridgeUtils.logDebug(TAG, "Cleaned up old camera file: ${file.name}")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error cleaning up camera files", e)
        }
    }
    
    /**
     * Convert captured image to base64 (if needed for small images)
     * 
     * @param activity The activity context
     * @param photoUri The photo URI
     * @param maxSizeBytes Maximum size for base64 conversion
     * @return Base64 string or null if too large or conversion fails
     */
    fun convertImageToBase64IfSmall(
        activity: Activity, 
        photoUri: Uri, 
        maxSizeBytes: Long = BridgeUtils.BASE64_SIZE_LIMIT
    ): String? {
        return try {
            val fileSize = FileUtils.getFileSize(activity, photoUri)
            if (fileSize <= maxSizeBytes) {
                FileUtils.convertUriToBase64(activity, photoUri)
            } else {
                BridgeUtils.logDebug(TAG, "Image too large for base64 conversion: ${BridgeUtils.formatFileSize(fileSize)}")
                null
            }
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error converting image to base64", e)
            null
        }
    }
}