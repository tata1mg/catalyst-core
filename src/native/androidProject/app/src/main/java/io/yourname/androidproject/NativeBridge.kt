package io.yourname.androidproject

import java.io.File
import java.util.Date
import android.net.Uri
import android.Manifest
import android.util.Log
import java.util.Locale
import android.util.Base64
import org.json.JSONObject
import java.io.InputStream
import android.webkit.WebView
import android.os.Environment
import android.content.Context
import java.text.SimpleDateFormat
import android.content.pm.PackageManager
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import android.view.HapticFeedbackConstants
import io.yourname.androidproject.BuildConfig
import io.yourname.androidproject.MainActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import android.webkit.JavascriptInterface


enum class WebEvents(val eventName: String) {
    ON_CAMERA_CAPTURE("ON_CAMERA_CAPTURE"),
    ON_CAMERA_ERROR("ON_CAMERA_ERROR"),
    CAMERA_PERMISSION_STATUS("CAMERA_PERMISSION_STATUS"),
    HAPTIC_FEEDBACK("HAPTIC_FEEDBACK"),
    // Intent-related events
    ON_INTENT_SUCCESS("ON_INTENT_SUCCESS"),
    ON_INTENT_ERROR("ON_INTENT_ERROR"),
    ON_INTENT_CANCELLED("ON_INTENT_CANCELLED"),
    // File picker events
    ON_FILE_PICKED("ON_FILE_PICKED"),
    ON_FILE_PICK_ERROR("ON_FILE_PICK_ERROR"),
    ON_FILE_PICK_CANCELLED("ON_FILE_PICK_CANCELLED"),
}

class NativeBridge(private val activity: MainActivity, private val webview: WebView) {
    private var currentPhotoUri: Uri? = null
    private var shouldLaunchCameraAfterPermission = false

    private lateinit var cameraLauncher: ActivityResultLauncher<Uri>
    private lateinit var permissionLauncher: ActivityResultLauncher<String>

    companion object {
        private const val TAG = "NativeBridge"
        private const val CAMERA_PERMISSION = Manifest.permission.CAMERA
        private const val FILE_PROVIDER_AUTHORITY = "io.yourname.androidproject.fileprovider"
    }

    init {
        try {
            initializeCameraLauncher()
            initializePermissionLauncher()
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing NativeBridge: ${e.message}")
        }
    }

    @JavascriptInterface
    fun logger() {
        try {
            activity.runOnUiThread {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Message from native")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in logger: ${e.message}")
        }
    }

    @JavascriptInterface
    fun openCamera() {
        try {
            activity.runOnUiThread {
                if (hasCameraPermission()) {
                    launchCamera()
                } else {
                    requestCameraPermissionAndLaunch(true)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in openCamera: ${e.message}")
            activity.runOnUiThread {
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Camera initialization error')",
                    null
                )
            }
        }
    }

    @JavascriptInterface
    fun requestCameraPermission() {
        try {
            activity.runOnUiThread {
                requestCameraPermissionAndLaunch(false)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in requestCameraPermission: ${e.message}")
        }
    }

    @JavascriptInterface
    fun requestHapticFeedback(feedbackType: String?) {
        try {
            activity.runOnUiThread {
                try {
                    val type = feedbackType?.uppercase() ?: "VIRTUAL_KEY"
                    val constant = when (type) {
                        "VIRTUAL_KEY" -> HapticFeedbackConstants.VIRTUAL_KEY
                        "LONG_PRESS" -> HapticFeedbackConstants.LONG_PRESS
                        "DEFAULT" -> HapticFeedbackConstants.VIRTUAL_KEY
                        else -> HapticFeedbackConstants.VIRTUAL_KEY
                    }

                    if (webview.performHapticFeedback(constant)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "Haptic feedback performed: $type")
                        }
                        webview.evaluateJavascript(
                            "window.WebBridge.callback('${WebEvents.HAPTIC_FEEDBACK}', 'SUCCESS')",
                            null
                        )
                    } else {
                        Log.w(TAG, "Haptic feedback failed for type: $type")
                        webview.evaluateJavascript(
                            "window.WebBridge.callback('${WebEvents.HAPTIC_FEEDBACK}', 'FAILED')",
                            null
                        )
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error triggering haptic feedback: ${e.message}")
                    webview.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.HAPTIC_FEEDBACK}', 'Error triggering feedback')",
                        null
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in requestHapticFeedback: ${e.message}")
        }
    }

    @JavascriptInterface
    fun openFileWithIntent(params: String?) {
        try {
            activity.runOnUiThread {
                Log.d(TAG, "🔗 openFileWithIntent called from JavaScript")
                Log.d(TAG, "📄 Received params: $params")
                
                if (params.isNullOrBlank()) {
                    Log.e(TAG, "❌ No parameters provided for openFileWithIntent")
                    webview.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_INTENT_ERROR}', 'No file URL provided')",
                        null
                    )
                    return@runOnUiThread
                }
                
                // Parse parameters (fileUrl|mimeType format or just fileUrl)
                val parts = params.split("|")
                val fileUrl = parts[0]
                val mimeType = if (parts.size > 1) parts[1] else null
                
                Log.d(TAG, "📁 File URL: $fileUrl")
                Log.d(TAG, "🎯 MIME Type: ${mimeType ?: "auto-detect"}")
                
                // TODO: Implement actual intent logic
                // For now, just log and send success callback
                Log.d(TAG, "✅ Intent functionality logged successfully")
                
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_INTENT_SUCCESS}', 'Intent logged successfully')",
                    null
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in openFileWithIntent: ${e.message}")
            activity.runOnUiThread {
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_INTENT_ERROR}', 'Error processing intent: ${e.message}')",
                    null
                )
            }
        }
    }

    @JavascriptInterface
    fun pickFile(mimeType: String?) {
        try {
            activity.runOnUiThread {
                Log.d(TAG, "📂 pickFile called from JavaScript")
                Log.d(TAG, "🎯 MIME Type filter: ${mimeType ?: "*/*"}")
                
                val effectiveMimeType = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
                Log.d(TAG, "🔍 Effective MIME Type: $effectiveMimeType")
                
                // TODO: Implement actual file picker logic
                // For now, just log and send success callback with mock data
                Log.d(TAG, "✅ File picker functionality logged successfully")
                
                val mockFileData = JSONObject().apply {
                    put("fileName", "mock_file.txt")
                    put("fileUri", "content://mock/path/file.txt")
                    put("mimeType", effectiveMimeType)
                    put("fileSize", 1024)
                }.toString()
                
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_FILE_PICKED}', '$mockFileData')",
                    null
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in pickFile: ${e.message}")
            activity.runOnUiThread {
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'Error processing file picker: ${e.message}')",
                    null
                )
            }
        }
    }

    private fun initializeCameraLauncher() {
        cameraLauncher = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
            if (success) {
                currentPhotoUri?.let { uri ->
                    try {
                        // In production version, we avoid sending full base64 image for performance
                        // Instead, just send the image URI and do processing on the web side if needed
                        val imageUrl = uri.toString()

                        val json = JSONObject().apply {
                            // Removed base64 encoding for production - it's memory intensive
                            // put("base64", base64Image)
                            put("imageUrl", imageUrl)
                        }.toString()

                        val jsCode = "window.WebBridge.callback('${WebEvents.ON_CAMERA_CAPTURE}', '$json')"
                        webview.evaluateJavascript(
                            jsCode,
                            null
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Error processing image: ${e.message}")
                        webview.evaluateJavascript(
                            "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Error processing image')",
                            null
                        )
                    }
                } ?: run {
                    Log.e(TAG, "Photo URI is null")
                    webview.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Photo URI is null')",
                        null
                    )
                }
            } else {
                Log.e(TAG, "Camera capture failed or was cancelled")
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Camera capture failed or was cancelled')",
                    null
                )
            }
        }
    }

    private fun initializePermissionLauncher() {
        permissionLauncher = activity.registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            if (isGranted) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Camera permission granted, launching camera")
                }
                if (shouldLaunchCameraAfterPermission) {
                    launchCamera()
                }
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.CAMERA_PERMISSION_STATUS}', 'GRANTED')",
                    null
                )
            } else {
                Log.e(TAG, "Camera permission denied")
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.CAMERA_PERMISSION_STATUS}', 'DENIED')",
                    null
                )
            }
        }
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            CAMERA_PERMISSION
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestCameraPermissionAndLaunch(shouldLaunch: Boolean) {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Requesting camera permission")
        }
        shouldLaunchCameraAfterPermission = shouldLaunch
        permissionLauncher.launch(CAMERA_PERMISSION)
    }

    private fun launchCamera() {
        try {
            val photoFile = createImageFile()
            currentPhotoUri = FileProvider.getUriForFile(
                activity,
                FILE_PROVIDER_AUTHORITY,
                photoFile
            )

            currentPhotoUri?.let { uri ->
                try {
                    cameraLauncher.launch(uri)
                } catch (e: Exception) {
                    Log.e(TAG, "Camera launch failed: ${e.message}")
                    webview.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Camera launch failed')",
                        null
                    )
                }
            } ?: run {
                Log.e(TAG, "Failed to create photo URI")
                webview.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Failed to create photo URI')",
                    null
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error preparing camera: ${e.message}")
            webview.evaluateJavascript(
                "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Error preparing camera')",
                null
            )
        }
    }

    private fun createImageFile(): File {
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

    private fun convertUriToBase64(context: Context, uri: Uri): String? {
        return try {
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            val bytes = inputStream?.readBytes()
            inputStream?.close()
            Base64.encodeToString(bytes, Base64.DEFAULT)
        } catch (e: Exception) {
            Log.e(TAG, "Base64 conversion error: ${e.message}")
            null
        }
    }
}