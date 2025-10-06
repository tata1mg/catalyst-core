package io.yourname.androidproject

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import io.yourname.androidproject.MainActivity
import io.yourname.androidproject.utils.*
import kotlinx.coroutines.*
import java.util.Properties

class NativeBridge(
    private val mainActivity: MainActivity,
    private val webView: WebView,
    private val properties: Properties
) : CoroutineScope {
    private var currentPhotoUri: Uri? = null
    private var shouldLaunchCameraAfterPermission = false
    private var allowedUrls: List<String> = emptyList()

    // Coroutine scope for async operations
    private val supervisorJob = SupervisorJob()
    override val coroutineContext = Dispatchers.Main + supervisorJob

    private lateinit var cameraLauncher: ActivityResultLauncher<Uri>
    private lateinit var permissionLauncher: ActivityResultLauncher<String>
    private lateinit var filePickerLauncher: ActivityResultLauncher<Intent>

    companion object {
        private const val TAG = "NativeBridge"

        /**
         * Parse and validate bridge message
         * @param messageJson JSON string containing bridge message
         * @return BridgeValidationResult with validation status
         */
        fun parseAndValidateMessage(messageJson: String): BridgeValidationResult {
            return try {
                val jsonObject = org.json.JSONObject(messageJson)
                BridgeMessageValidator.validate(jsonObject)
            } catch (e: org.json.JSONException) {
                BridgeUtils.logError(TAG, "Failed to parse message JSON", e)
                BridgeValidationResult(
                    isValid = false,
                    command = null,
                    params = null,
                    body = null,
                    error = BridgeValidationError(
                        message = "Invalid JSON format: ${e.message}",
                        code = "INVALID_JSON",
                        eventName = "BRIDGE_ERROR"
                    )
                )
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Unexpected error during validation", e)
                BridgeValidationResult(
                    isValid = false,
                    command = null,
                    params = null,
                    body = null,
                    error = BridgeValidationError(
                        message = "Validation error: ${e.message}",
                        code = "VALIDATION_ERROR",
                        eventName = "BRIDGE_ERROR"
                    )
                )
            }
        }
    }

    init {
        try {
            // Load allowed URLs from properties for whitelisting
            allowedUrls = properties.getProperty("accessControl.allowedUrls", "")
                .split(",")
                .map { it.trim() }
                .filter { it.isNotEmpty() }

            if (allowedUrls.isNotEmpty()) {
                BridgeUtils.logDebug(TAG, "Whitelisting enabled with ${allowedUrls.size} allowed URLs")
            }

            initializeCameraLauncher()
            initializePermissionLauncher()
            initializeFilePickerLauncher()

            // Initialize FrameworkServer for large file handling
            initializeFrameworkServer()
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error initializing NativeBridge", e)
        }
    }

    @JavascriptInterface
    fun logger() {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_CAMERA_ERROR, "logger") {
            mainActivity.runOnUiThread {
                BridgeUtils.logDebug(TAG, "Message from native")
            }
        }
    }

    @JavascriptInterface
    fun openCamera(options: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_CAMERA_ERROR, "open camera") {
            mainActivity.runOnUiThread {
                if (CameraUtils.hasCameraPermission(mainActivity)) {
                    launchCamera()
                } else {
                    requestCameraPermissionAndLaunch(true)
                }
            }
        }
    }

    @JavascriptInterface
    fun requestCameraPermission(config: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.CAMERA_PERMISSION_STATUS, "request camera permission") {
            mainActivity.runOnUiThread {
                requestCameraPermissionAndLaunch(false)
            }
        }
    }

    @JavascriptInterface
    fun requestHapticFeedback(feedbackType: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.HAPTIC_FEEDBACK, "trigger haptic feedback") {
            mainActivity.runOnUiThread {
                val type = feedbackType?.uppercase() ?: "VIRTUAL_KEY"
                val constant = when (type) {
                    "VIRTUAL_KEY" -> HapticFeedbackConstants.VIRTUAL_KEY
                    "LONG_PRESS" -> HapticFeedbackConstants.LONG_PRESS
                    "DEFAULT" -> HapticFeedbackConstants.VIRTUAL_KEY
                    else -> HapticFeedbackConstants.VIRTUAL_KEY
                }

                if (webView.performHapticFeedback(constant)) {
                    BridgeUtils.logDebug(TAG, "Haptic feedback performed: $type")
                    BridgeUtils.notifyWebSuccess(webView, BridgeUtils.WebEvents.HAPTIC_FEEDBACK)
                } else {
                    throw Exception("Haptic feedback failed for type: $type")
                }
            }
        }
    }

    @JavascriptInterface
    fun openFileWithIntent(params: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_INTENT_ERROR, "open file with intent") {
            mainActivity.runOnUiThread {
                BridgeUtils.logDebug(TAG, "openFileWithIntent called with params: $params")

                // Parse and validate parameters
                val (fileUrl, mimeType) = IntentUtils.parseIntentParams(params)
                IntentUtils.validateFileUrl(fileUrl)

                BridgeUtils.logDebug(TAG, "File URL: $fileUrl, MIME Type: ${mimeType ?: "auto-detect"}")

                // Download and open file
                downloadAndOpenFile(fileUrl, mimeType)
            }
        }
    }

    @JavascriptInterface
    fun pickFile(mimeType: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, "pick file") {
            mainActivity.runOnUiThread {
                BridgeUtils.logDebug(TAG, "pickFile called from JavaScript")
                BridgeUtils.logDebug(TAG, "MIME Type filter: ${mimeType ?: "*/*"}")

                // Send initial state
                FileUtils.sendFilePickStateUpdate(webView, "opening")

                val effectiveMimeType = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
                BridgeUtils.logDebug(TAG, "Effective MIME Type: $effectiveMimeType")

                // Launch file picker
                launchFilePicker(effectiveMimeType)
            }
        }
    }

    @JavascriptInterface
    fun getDeviceInfo(options: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_DEVICE_INFO_ERROR, "get device info") {
            mainActivity.runOnUiThread {
                val deviceInfo = DeviceInfoUtils.getDeviceInfo(mainActivity)
                BridgeUtils.logDebug(TAG, "Device info retrieved: $deviceInfo")
                BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_DEVICE_INFO_SUCCESS, deviceInfo.toString())
            }
        }
    }

    private fun initializeCameraLauncher() {
        cameraLauncher = mainActivity.registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
            CameraUtils.processCameraResult(mainActivity, webView, currentPhotoUri, success)
        }
    }

    private fun initializePermissionLauncher() {
        permissionLauncher = mainActivity.registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            val onPermissionGranted = if (shouldLaunchCameraAfterPermission) {
                { launchCamera() }
            } else null
            
            CameraUtils.handlePermissionResult(webView, isGranted, onPermissionGranted)
        }
    }

    private fun initializeFilePickerLauncher() {
        filePickerLauncher = mainActivity.registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            when (result.resultCode) {
                Activity.RESULT_OK -> {
                    result.data?.data?.let { uri ->
                        BridgeUtils.logDebug(TAG, "File selected: $uri")
                        FileUtils.sendFilePickStateUpdate(webView, "processing")
                        
                        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, "process selected file") {
                            // Use new tri-transport processing
                            processSelectedFileWithTriTransport(uri)
                        }
                    } ?: run {
                        BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, "No file selected")
                    }
                }
                Activity.RESULT_CANCELED -> {
                    BridgeUtils.logDebug(TAG, "File picker cancelled")
                    BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_FILE_PICK_CANCELLED, "File selection cancelled")
                }
                else -> {
                    BridgeUtils.logError(TAG, "File picker failed with result code: ${result.resultCode}")
                    BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, "File selection failed")
                }
            }
        }
    }
    
    private fun initializeFrameworkServer() {
        BridgeUtils.logDebug(TAG, "Initializing FrameworkServer for large file handling")
        
        // Start framework server in background
        launch {
            try {
                val serverStarted = FrameworkServerUtils.startServer(mainActivity, webView)
                if (serverStarted) {
                    BridgeUtils.logInfo(TAG, "FrameworkServer initialized successfully")
                } else {
                    BridgeUtils.logWarning(TAG, "FrameworkServer failed to start - large files will use fallback methods")
                }
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Error starting FrameworkServer", e)
            }
        }
    }
    
    /**
     * Process selected file using tri-transport architecture based on file size
     */
    private fun processSelectedFileWithTriTransport(uri: Uri) {
        launch {
            try {
                // Convert URI to File
                val file = FileUtils.uriToFile(mainActivity, uri)
                if (file == null) {
                    BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, "Unable to access selected file")
                    return@launch
                }
                
                BridgeUtils.logDebug(TAG, "Processing file with tri-transport: ${file.name} (${FileSizeRouterUtils.formatFileSize(file.length())})")
                
                // Determine transport method based on file size
                val routingDecision = FileSizeRouterUtils.determineTransport(file)
                BridgeUtils.logInfo(TAG, "Transport decision: ${routingDecision.transportType} - ${routingDecision.reason}")
                
                // Update WebView with transport information
                FileUtils.sendFilePickStateUpdate(webView, "routing")
                
                // Process file using determined transport
                val processingResult = FileSizeRouterUtils.processFile(mainActivity, webView, routingDecision)
                
                if (processingResult.success && processingResult.fileSrc != null) {
                    // Notify WebView with successful result
                    val resultData = mapOf(
                        "fileName" to processingResult.fileName,
                        "fileSrc" to processingResult.fileSrc,
                        "filePath" to processingResult.filePath,
                        "size" to processingResult.fileSize,
                        "mimeType" to processingResult.mimeType,
                        "transport" to processingResult.transportUsed.name
                    )
                    
                    BridgeUtils.logInfo(TAG, "File processed successfully via ${processingResult.transportUsed}: ${processingResult.fileName}")
                    BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_FILE_PICKED, 
                        org.json.JSONObject(resultData).toString())
                    
                } else {
                    // Processing failed
                    val errorMsg = processingResult.error ?: "Unknown error processing file"
                    BridgeUtils.logError(TAG, "File processing failed: $errorMsg")
                    BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, errorMsg)
                }
                
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Error in tri-transport file processing", e)
                BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, 
                    "File processing error: ${e.message}")
            }
        }
    }

    private fun launchFilePicker(mimeType: String) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, "launch file picker") {
            val intent = IntentUtils.createFilePickerIntent(mimeType, false)
            BridgeUtils.logDebug(TAG, "Launching file picker with MIME type: $mimeType")
            filePickerLauncher.launch(intent)
        }
    }

    // Removed processSelectedFile - now handled by FileUtils.processSelectedFile

    // Removed createAccessibleFileUrl - now handled by FileUtils.createAccessibleFileUrl

    // Removed cleanupTempFiles - now handled by FileUtils.cleanupTempFiles

    // Removed getFileSize - now handled by FileUtils.getFileSize
    
    /**
     * Cleanup method to be called when the bridge is being destroyed
     */
    fun cleanup() {
        BridgeUtils.logDebug(TAG, "Cleaning up NativeBridge resources")
        
        try {
            // Stop FrameworkServer
            FrameworkServerUtils.stopServer()
            
            // Cancel any pending coroutines
            supervisorJob.cancel()
            
            BridgeUtils.logInfo(TAG, "NativeBridge cleanup completed")
        } catch (e: Exception) {
            BridgeUtils.logError(TAG, "Error during NativeBridge cleanup", e)
        }
    }

    // Removed getFileName - now handled by FileUtils.getFileName

    // Removed getDisplayName - now handled by FileUtils.getDisplayName

    // Removed getMimeType - now handled by FileUtils.getMimeType

    // Removed hasCameraPermission - now handled by CameraUtils.hasCameraPermission

    private fun requestCameraPermissionAndLaunch(shouldLaunch: Boolean) {
        BridgeUtils.logDebug(TAG, "Requesting camera permission")
        shouldLaunchCameraAfterPermission = shouldLaunch
        permissionLauncher.launch(android.Manifest.permission.CAMERA)
    }

    private fun launchCamera() {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_CAMERA_ERROR, "launch camera") {
            currentPhotoUri = CameraUtils.createCameraUri(mainActivity)
            currentPhotoUri?.let { uri ->
                cameraLauncher.launch(uri)
            } ?: throw Exception("Failed to create photo URI")
        }
    }

    // Removed createImageFile - now handled by CameraUtils.createCameraUri

    // Removed convertUriToBase64 - now handled by FileUtils.convertUriToBase64

    private fun downloadAndOpenFile(fileUrl: String, mimeType: String?) {
        launch(Dispatchers.IO) {
            DownloadUtils.downloadFileWithCallback(
                mainActivity,
                webView,
                fileUrl,
                mimeType,
                allowedUrls,
                onSuccess = { downloadedFile, detectedMimeType ->
                    IntentUtils.openFileWithSystemIntent(mainActivity, webView, downloadedFile, detectedMimeType)
                }
            )
        }
    }

    // Removed openFileWithSystemIntent - now handled by IntentUtils.openFileWithSystemIntent

    // Removed extractFileNameFromUrl - now handled by DownloadUtils.extractFileNameFromUrl

    // Removed createTempFile - now handled by FileUtils.createTempFile

    // Removed detectMimeType - now handled by FileUtils.detectMimeType

    // Removed sendFilePickStateUpdate - now handled by FileUtils.sendFilePickStateUpdate

    fun destroy() {
        supervisorJob.cancel()
    }
}