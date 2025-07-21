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
import android.content.Intent
import android.webkit.MimeTypeMap
import kotlinx.coroutines.*
import java.net.URL
import java.io.FileOutputStream
import java.io.IOException
import android.app.Activity
import android.database.Cursor
import android.provider.OpenableColumns


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
    ON_FILE_PICK_STATE_UPDATE("ON_FILE_PICK_STATE_UPDATE"),
}

class NativeBridge(private val mainActivity: MainActivity, private val webView: WebView) : CoroutineScope {
    private var currentPhotoUri: Uri? = null
    private var shouldLaunchCameraAfterPermission = false

    // Coroutine scope for async operations
    private val supervisorJob = SupervisorJob()
    override val coroutineContext = Dispatchers.Main + supervisorJob

    private lateinit var cameraLauncher: ActivityResultLauncher<Uri>
    private lateinit var permissionLauncher: ActivityResultLauncher<String>
    private lateinit var filePickerLauncher: ActivityResultLauncher<Intent>

    companion object {
        private const val TAG = "NativeBridge"
        private const val CAMERA_PERMISSION = Manifest.permission.CAMERA
        private const val FILE_PROVIDER_AUTHORITY = "io.yourname.androidproject.fileprovider"

        // File size limits
        private const val MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024L // 10MB absolute limit
        private const val MAX_FILE_SIZE_MB = 10
        private const val BASE64_SIZE_LIMIT = 2 * 1024 * 1024L // 2MB limit for base64 conversion
        private const val BASE64_SIZE_LIMIT_MB = 2
    }

    init {
        try {
            initializeCameraLauncher()
            initializePermissionLauncher()
            initializeFilePickerLauncher()
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing NativeBridge: ${e.message}")
        }
    }

    @JavascriptInterface
    fun logger() {
        try {
            mainActivity.runOnUiThread {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Message from native")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in logger: ${e.message}")
        }
    }

    @JavascriptInterface
    fun openCamera(abc:String) {
        try {
            mainActivity.runOnUiThread {
                if (hasCameraPermission()) {
                    launchCamera()
                } else {
                    requestCameraPermissionAndLaunch(true)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in openCamera: ${e.message}")
            mainActivity.runOnUiThread {
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Camera initialization error')",
                    null
                )
            }
        }
    }

    @JavascriptInterface
    fun requestCameraPermission(abc:String) {
        try {
            mainActivity.runOnUiThread {
                requestCameraPermissionAndLaunch(false)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in requestCameraPermission: ${e.message}")
        }
    }

    @JavascriptInterface
    fun requestHapticFeedback(feedbackType: String?) {
        try {
            mainActivity.runOnUiThread {
                try {
                    val type = feedbackType?.uppercase() ?: "VIRTUAL_KEY"
                    val constant = when (type) {
                        "VIRTUAL_KEY" -> HapticFeedbackConstants.VIRTUAL_KEY
                        "LONG_PRESS" -> HapticFeedbackConstants.LONG_PRESS
                        "DEFAULT" -> HapticFeedbackConstants.VIRTUAL_KEY
                        else -> HapticFeedbackConstants.VIRTUAL_KEY
                    }

                    if (webView.performHapticFeedback(constant)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "Haptic feedback performed: $type")
                        }
                        webView.evaluateJavascript(
                            "window.WebBridge.callback('${WebEvents.HAPTIC_FEEDBACK}', 'SUCCESS')",
                            null
                        )
                    } else {
                        Log.w(TAG, "Haptic feedback failed for type: $type")
                        webView.evaluateJavascript(
                            "window.WebBridge.callback('${WebEvents.HAPTIC_FEEDBACK}', 'FAILED')",
                            null
                        )
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error triggering haptic feedback: ${e.message}")
                    webView.evaluateJavascript(
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
            mainActivity.runOnUiThread {
                Log.d(TAG, "🔗 openFileWithIntent called from JavaScript")
                Log.d(TAG, "📄 Received params: $params")

                if (params.isNullOrBlank()) {
                    Log.e(TAG, "❌ No parameters provided for openFileWithIntent")
                    webView.evaluateJavascript(
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

                // Only handle remote URLs
                if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
                    Log.d(TAG, "🌐 Remote URL detected, downloading file...")
                    downloadAndOpenFile(fileUrl, mimeType)
                } else {
                    Log.e(TAG, "❌ Only remote URLs (http/https) are supported")
                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_INTENT_ERROR}', 'Only remote URLs (http/https) are supported')",
                        null
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in openFileWithIntent: ${e.message}")
            mainActivity.runOnUiThread {
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_INTENT_ERROR}', 'Error processing intent: ${e.message}')",
                    null
                )
            }
        }
    }

    @JavascriptInterface
    fun pickFile(mimeType: String?) {
        try {
            mainActivity.runOnUiThread {
                Log.d(TAG, "📂 pickFile called from JavaScript")
                Log.d(TAG, "🎯 MIME Type filter: ${mimeType ?: "*/*"}")

                // Send initial state
                sendFilePickStateUpdate("opening")

                val effectiveMimeType = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
                Log.d(TAG, "🔍 Effective MIME Type: $effectiveMimeType")

                // Launch file picker
                launchFilePicker(effectiveMimeType)
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error in pickFile: ${e.message}")
            mainActivity.runOnUiThread {
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'Error processing file picker: ${e.message}')",
                    null
                )
            }
        }
    }

    private fun initializeCameraLauncher() {
        cameraLauncher = mainActivity.registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
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
                        webView.evaluateJavascript(
                            jsCode,
                            null
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Error processing image: ${e.message}")
                        webView.evaluateJavascript(
                            "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Error processing image')",
                            null
                        )
                    }
                } ?: run {
                    Log.e(TAG, "Photo URI is null")
                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Photo URI is null')",
                        null
                    )
                }
            } else {
                Log.e(TAG, "Camera capture failed or was cancelled")
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Camera capture failed or was cancelled')",
                    null
                )
            }
        }
    }

    private fun initializePermissionLauncher() {
        permissionLauncher = mainActivity.registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            if (isGranted) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Camera permission granted, launching camera")
                }
                if (shouldLaunchCameraAfterPermission) {
                    launchCamera()
                }
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.CAMERA_PERMISSION_STATUS}', 'GRANTED')",
                    null
                )
            } else {
                Log.e(TAG, "Camera permission denied")
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.CAMERA_PERMISSION_STATUS}', 'DENIED')",
                    null
                )
            }
        }
    }

    private fun initializeFilePickerLauncher() {
        filePickerLauncher = mainActivity.registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            when (result.resultCode) {
                Activity.RESULT_OK -> {
                    result.data?.data?.let { uri ->
                        Log.d(TAG, "✅ File selected: $uri")
                        sendFilePickStateUpdate("processing")
                        processSelectedFile(uri)
                    } ?: run {
                        Log.e(TAG, "❌ No file data received")
                        webView.evaluateJavascript(
                            "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'No file selected')",
                            null
                        )
                    }
                }
                Activity.RESULT_CANCELED -> {
                    Log.d(TAG, "📄 File picker cancelled")
                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_CANCELLED}', 'File selection cancelled')",
                        null
                    )
                }
                else -> {
                    Log.e(TAG, "❌ File picker failed with result code: ${result.resultCode}")
                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'File selection failed')",
                        null
                    )
                }
            }
        }
    }

    private fun launchFilePicker(mimeType: String) {
        try {
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = mimeType
                addCategory(Intent.CATEGORY_OPENABLE)
                // Single file selection is the default behavior
            }

            Log.d(TAG, "🚀 Launching file picker with MIME type: $mimeType")
            filePickerLauncher.launch(intent)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error launching file picker: ${e.message}")
            webView.evaluateJavascript(
                "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'Error launching file picker: ${e.message}')",
                null
            )
        }
    }

    private fun processSelectedFile(uri: Uri) {
        try {
            Log.d(TAG, "🔍 Processing selected file: $uri")

            // Get file size first
            val fileSize = getFileSize(uri)
            Log.d(TAG, "📏 File size: ${fileSize} bytes (${fileSize / (1024 * 1024)}MB)")

            // Check absolute size limit
            if (fileSize > MAX_FILE_SIZE_BYTES) {
                val fileSizeMB = fileSize / (1024 * 1024)
                Log.e(TAG, "❌ File too large: ${fileSizeMB}MB (max: ${MAX_FILE_SIZE_MB}MB)")
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'File too large. Maximum size: ${MAX_FILE_SIZE_MB}MB (selected: ${fileSizeMB}MB)')",
                    null
                )
                return
            }

            // Get file metadata
            val fileName = getFileName(uri)
            val mimeType = getMimeType(uri)
            val displayName = getDisplayName(uri)

            Log.d(TAG, "📁 File name: $fileName")
            Log.d(TAG, "🏷️ Display name: $displayName")
            Log.d(TAG, "🎯 MIME type: $mimeType")

            // Check if file is small enough for base64 conversion
            if (fileSize <= BASE64_SIZE_LIMIT) {
                Log.d(TAG, "📄 File is small enough for base64 conversion (${fileSize / (1024 * 1024)}MB ≤ ${BASE64_SIZE_LIMIT_MB}MB)")

                // Convert to base64
                val base64Data = convertUriToBase64(mainActivity, uri)

                if (base64Data != null) {
                    Log.d(TAG, "✅ Base64 conversion successful")

                    // Create file data JSON with base64
                    val fileData = JSONObject().apply {
                        put("fileName", fileName)
                        put("displayName", displayName)
                        put("fileUri", uri.toString()) // Original URI
                        put("mimeType", mimeType)
                        put("fileSize", fileSize)
                        put("fileSizeMB", String.format("%.2f", fileSize / (1024.0 * 1024.0)))
                        put("base64Data", base64Data) // Base64 encoded file data
                        put("dataUrl", "data:$mimeType;base64,$base64Data") // Ready-to-use data URL
                    }.toString()

                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_FILE_PICKED}', '$fileData')",
                        null
                    )
                } else {
                    Log.e(TAG, "❌ Base64 conversion failed")
                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'Error converting file to base64')",
                        null
                    )
                }
            } else {
                // File is too large for base64 conversion
                val fileSizeMB = String.format("%.2f", fileSize / (1024.0 * 1024.0))
                Log.w(TAG, "⚠️ File too large for base64 conversion: ${fileSizeMB}MB > ${BASE64_SIZE_LIMIT_MB}MB")

                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'File too large for preview. Maximum size for preview: ${BASE64_SIZE_LIMIT_MB}MB (selected: ${fileSizeMB}MB). Please select a smaller file.')",
                    null
                )
            }

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error processing file: ${e.message}")
            webView.evaluateJavascript(
                "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_ERROR}', 'Error processing file: ${e.message}')",
                null
            )
        }
    }

    private fun createAccessibleFileUrl(uri: Uri, fileName: String): String {
        return try {
            // Create a temporary accessible file
            val tempDir = File(mainActivity.cacheDir, "accessible_files")
            if (!tempDir.exists()) {
                tempDir.mkdirs()
            }

            // Clean filename for filesystem
            val cleanFileName = fileName.replace("[^a-zA-Z0-9._-]".toRegex(), "_")
            val tempFile = File(tempDir, "temp_${System.currentTimeMillis()}_$cleanFileName")

            // Copy content to accessible location
            mainActivity.contentResolver.openInputStream(uri)?.use { inputStream ->
                FileOutputStream(tempFile).use { outputStream ->
                    inputStream.copyTo(outputStream)
                }
            }

            // Create FileProvider URI that WebView can access
            val accessibleUri = FileProvider.getUriForFile(
                mainActivity,
                FILE_PROVIDER_AUTHORITY,
                tempFile
            )

            Log.d(TAG, "📋 Created accessible file: ${tempFile.absolutePath}")
            Log.d(TAG, "🔗 Accessible URI: $accessibleUri")

            accessibleUri.toString()

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error creating accessible file: ${e.message}")
            // Fallback to original URI (might not work in WebView)
            uri.toString()
        }
    }

    private fun cleanupTempFiles() {
        try {
            val tempDir = File(mainActivity.cacheDir, "accessible_files")
            if (tempDir.exists()) {
                val files = tempDir.listFiles()
                val currentTime = System.currentTimeMillis()
                val maxAge = 24 * 60 * 60 * 1000L // 24 hours

                files?.forEach { file ->
                    if (currentTime - file.lastModified() > maxAge) {
                        file.delete()
                        Log.d(TAG, "🧹 Cleaned up old temp file: ${file.name}")
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error cleaning up temp files: ${e.message}")
        }
    }

    private fun getFileSize(uri: Uri): Long {
        return try {
            mainActivity.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIndex != -1) {
                    cursor.moveToFirst()
                    cursor.getLong(sizeIndex)
                } else {
                    0L
                }
            } ?: 0L
        } catch (e: Exception) {
            Log.e(TAG, "Error getting file size: ${e.message}")
            0L
        }
    }

    private fun getFileName(uri: Uri): String {
        return try {
            mainActivity.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex != -1) {
                    cursor.moveToFirst()
                    cursor.getString(nameIndex) ?: "unknown_file"
                } else {
                    "unknown_file"
                }
            } ?: "unknown_file"
        } catch (e: Exception) {
            Log.e(TAG, "Error getting file name: ${e.message}")
            "unknown_file"
        }
    }

    private fun getDisplayName(uri: Uri): String {
        // For now, same as fileName, but could be enhanced for better display
        return getFileName(uri)
    }

    private fun getMimeType(uri: Uri): String {
        return try {
            mainActivity.contentResolver.getType(uri) ?: run {
                // Fallback: try to detect from file extension
                val fileName = getFileName(uri)
                val extension = fileName.substringAfterLast(".", "")
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.lowercase()) ?: "*/*"
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error getting MIME type: ${e.message}")
            "*/*"
        }
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            mainActivity,
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
                mainActivity,
                FILE_PROVIDER_AUTHORITY,
                photoFile
            )

            currentPhotoUri?.let { uri ->
                try {
                    cameraLauncher.launch(uri)
                } catch (e: Exception) {
                    Log.e(TAG, "Camera launch failed: ${e.message}")
                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Camera launch failed')",
                        null
                    )
                }
            } ?: run {
                Log.e(TAG, "Failed to create photo URI")
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Failed to create photo URI')",
                    null
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error preparing camera: ${e.message}")
            webView.evaluateJavascript(
                "window.WebBridge.callback('${WebEvents.ON_CAMERA_ERROR}', 'Error preparing camera')",
                null
            )
        }
    }

    private fun createImageFile(): File {
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val storageDir = mainActivity.getExternalFilesDir(Environment.DIRECTORY_PICTURES)

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
            Log.d(TAG, "🔄 Converting URI to base64: $uri")
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            val bytes = inputStream?.readBytes()
            inputStream?.close()

            if (bytes != null) {
                Log.d(TAG, "✅ Successfully read ${bytes.size} bytes")
                Base64.encodeToString(bytes, Base64.NO_WRAP) // NO_WRAP to avoid newlines
            } else {
                Log.e(TAG, "❌ Failed to read bytes from URI")
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Base64 conversion error: ${e.message}")
            null
        }
    }

    private fun downloadAndOpenFile(fileUrl: String, mimeType: String?) {
        Log.d(TAG, "⬇️ Starting download for: $fileUrl")

        launch(Dispatchers.IO) {
            try {
                val url = URL(fileUrl)
                val fileName = extractFileNameFromUrl(fileUrl)
                val tempFile = createTempFile(fileName)

                Log.d(TAG, "💾 Downloading to: ${tempFile.absolutePath}")

                // Download file
                url.openStream().use { input ->
                    FileOutputStream(tempFile).use { output ->
                        input.copyTo(output)
                    }
                }

                Log.d(TAG, "✅ Download completed: ${tempFile.length()} bytes")

                // Switch back to main thread for intent
                withContext(Dispatchers.Main) {

                    val detectedMimeType = mimeType ?: detectMimeType(tempFile.absolutePath)
                    openFileWithSystemIntent(tempFile, detectedMimeType)
                }

            } catch (e: IOException) {
                Log.e(TAG, "❌ Download failed: ${e.message}")
                withContext(Dispatchers.Main) {
                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_INTENT_ERROR}', 'Failed to download file: ${e.message}')",
                        null
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ Unexpected error during download: ${e.message}")
                withContext(Dispatchers.Main) {
                    webView.evaluateJavascript(
                        "window.WebBridge.callback('${WebEvents.ON_INTENT_ERROR}', 'Error downloading file: ${e.message}')",
                        null
                    )
                }
            }
        }
    }

    private fun openFileWithSystemIntent(file: File, mimeType: String) {
        try {
            Log.d(TAG, "🚀 Creating intent for file: ${file.name}")
            Log.d(TAG, "🎯 MIME type: $mimeType")

            val uri = FileProvider.getUriForFile(
                mainActivity,
                FILE_PROVIDER_AUTHORITY,
                file
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType)
                flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
            }

            // Check if any apps can handle this intent
            if (intent.resolveActivity(mainActivity.packageManager) != null) {
                val chooser = Intent.createChooser(intent, "Open file with...")
                mainActivity.startActivity(chooser)

                Log.d(TAG, "✅ Intent launched successfully")
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_INTENT_SUCCESS}', 'File opened successfully')",
                    null
                )
            } else {
                Log.e(TAG, "❌ No apps available to handle MIME type: $mimeType")
                webView.evaluateJavascript(
                    "window.WebBridge.callback('${WebEvents.ON_INTENT_ERROR}', 'No apps available to open this file type')",
                    null
                )
            }

        } catch (e: Exception) {
            Log.e(TAG, "❌ Error creating intent: ${e.message}")
            webView.evaluateJavascript(
                "window.WebBridge.callback('${WebEvents.ON_INTENT_ERROR}', 'Error opening file: ${e.message}')",
                null
            )
        }
    }

    private fun extractFileNameFromUrl(url: String): String {
        return try {
            val fileName = url.substringAfterLast("/").substringBefore("?")
            if (fileName.isBlank()) "downloaded_file" else fileName
        } catch (e: Exception) {
            "downloaded_file"
        }
    }

    private fun createTempFile(fileName: String): File {
        val tempDir = File(mainActivity.cacheDir, "downloaded_files")
        if (!tempDir.exists()) {
            tempDir.mkdirs()
        }

        val cleanFileName = fileName.replace("[^a-zA-Z0-9._-]".toRegex(), "_")
        return File(tempDir, cleanFileName)
    }

    private fun detectMimeType(filePath: String): String {
        val extension = filePath.substringAfterLast(".", "")
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.lowercase()) ?: "*/*"
    }

    private fun sendFilePickStateUpdate(state: String) {
        val stateJson = JSONObject().apply {
            put("state", state)
        }.toString()

        Log.d(TAG, "📊 File picker state update: $state")
        webView.evaluateJavascript(
            "window.WebBridge.callback('${WebEvents.ON_FILE_PICK_STATE_UPDATE}', '$stateJson')",
            null
        )
    }

    fun destroy() {
        supervisorJob.cancel()
    }
}