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
import org.json.JSONArray
import org.json.JSONObject
import java.util.Properties

private data class FilePickerOptions(
    val mimeType: String = "*/*",
    val multiple: Boolean = false,
    val minFiles: Int? = null,
    val maxFiles: Int? = null,
    val minFileSize: Long? = null,
    val maxFileSize: Long? = null
) {
    companion object {
        fun fromRaw(optionsRaw: String?): FilePickerOptions {
            if (optionsRaw.isNullOrBlank()) {
                return FilePickerOptions()
            }

            val trimmed = optionsRaw.trim()

            // Backward compatibility: plain MIME type strings
            if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
                return FilePickerOptions(mimeType = trimmed.ifBlank { "*/*" })
            }

            return try {
                val json = JSONObject(trimmed)

                val mimeType = json.optString("mimeType").ifBlank { "*/*" }
                val explicitMultiple = json.optBoolean("multiple", false)
                val minFiles = json.optIntNullable("minFiles")
                val maxFiles = json.optIntNullable("maxFiles")
                val minFileSize = json.optLongNullable("minFileSize")
                val maxFileSize = json.optLongNullable("maxFileSize")

                // Auto-enable multiple select when constraints demand more than one file
                val shouldAllowMultiple = explicitMultiple ||
                    (minFiles != null && minFiles > 1) ||
                    (maxFiles != null && maxFiles > 1)

                FilePickerOptions(
                    mimeType = mimeType,
                    multiple = shouldAllowMultiple,
                    minFiles = minFiles,
                    maxFiles = maxFiles,
                    minFileSize = minFileSize,
                    maxFileSize = maxFileSize
                )
            } catch (e: Exception) {
                Log.e("FilePickerOptions", "Failed to parse options JSON", e)
                FilePickerOptions(mimeType = trimmed.ifBlank { "*/*" })
            }
        }
    }

    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("mimeType", mimeType)
        json.put("multiple", multiple)
        minFiles?.let { json.put("minFiles", it) }
        maxFiles?.let { json.put("maxFiles", it) }
        minFileSize?.let { json.put("minFileSize", it) }
        maxFileSize?.let { json.put("maxFileSize", it) }
        return json
    }
}

private fun JSONObject.optIntNullable(key: String): Int? =
    if (has(key) && !isNull(key)) getInt(key) else null

private fun JSONObject.optLongNullable(key: String): Long? =
    if (has(key) && !isNull(key)) getLong(key) else null

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
    private var currentFilePickerOptions: FilePickerOptions = FilePickerOptions()

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
    fun pickFile(optionsJson: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, "pick file") {
            mainActivity.runOnUiThread {
                currentFilePickerOptions = FilePickerOptions.fromRaw(optionsJson)

                BridgeUtils.logDebug(TAG, "pickFile called from JavaScript")
                BridgeUtils.logDebug(TAG, "Options: $currentFilePickerOptions")

                // Send initial state to web layer
                FileUtils.sendFilePickStateUpdate(webView, "opening")

                // Launch file picker with resolved configuration
                launchFilePicker(currentFilePickerOptions)
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
                    val data = result.data
                    val options = currentFilePickerOptions
                    val selectedUris = mutableListOf<Uri>()

                    val clipData = data?.clipData
                    if (clipData != null) {
                        for (index in 0 until clipData.itemCount) {
                            clipData.getItemAt(index)?.uri?.let { selectedUris.add(it) }
                        }
                    } else {
                        data?.data?.let { selectedUris.add(it) }
                    }

                    if (selectedUris.isEmpty()) {
                        notifyFilePickError("No file selected")
                        return@registerForActivityResult
                    }

                    BridgeUtils.logDebug(
                        TAG,
                        "Files selected (${selectedUris.size}): ${selectedUris.joinToString { it.toString() }}"
                    )

                    if (!validateFileSelectionCount(selectedUris.size, options)) {
                        return@registerForActivityResult
                    }

                    val urisToProcess = sanitizeSelectionForSingleSelect(selectedUris, options)

                    FileUtils.sendFilePickStateUpdate(webView, "processing")

                    BridgeUtils.safeExecute(
                        webView,
                        BridgeUtils.WebEvents.ON_FILE_PICK_ERROR,
                        "process selected files"
                    ) {
                        processSelectedFiles(urisToProcess, options)
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
    
    private fun processSelectedFiles(uris: List<Uri>, options: FilePickerOptions) {
        launch {
            try {
                val filesArray = JSONArray()
                var totalSize = 0L
                var firstFile: JSONObject? = null

                uris.forEachIndexed { index, uri ->
                    val processed = processFile(index, uri, options) ?: return@launch
                    filesArray.put(processed)
                    totalSize += processed.optLong("size")
                    if (firstFile == null) {
                        firstFile = processed
                    }
                }

                if (filesArray.length() == 0) {
                    notifyFilePickError("No files processed")
                    return@launch
                }

                val payload = JSONObject().apply {
                    put("multiple", filesArray.length() > 1)
                    put("count", filesArray.length())
                    put("totalSize", totalSize)
                    put("files", filesArray)
                    put("options", options.toJson())
                    firstFile?.let { first ->
                        put("fileName", first.optString("fileName", null))
                        put("fileSrc", first.optString("fileSrc", null))
                        put("filePath", first.optString("filePath", null))
                        put("size", first.optLong("size"))
                        put("mimeType", first.optString("mimeType", null))
                        put("transport", first.optString("transport", null))
                    }
                }

                BridgeUtils.notifyWeb(
                    webView,
                    BridgeUtils.WebEvents.ON_FILE_PICKED,
                    payload.toString()
                )
            } catch (e: Exception) {
                BridgeUtils.logError(TAG, "Error processing selected files", e)
                notifyFilePickError("File processing error: ${e.message}")
            }
        }
    }

    private fun processFile(index: Int, uri: Uri, options: FilePickerOptions): JSONObject? {
        val declaredSize = FileUtils.getFileSize(mainActivity, uri)
        if (!passesSizeBounds(index, declaredSize, options)) {
            return null
        }

        val file = FileUtils.uriToFile(mainActivity, uri) ?: run {
            val message = "Unable to access selected file at index ${index + 1}"
            BridgeUtils.logError(TAG, message)
            notifyFilePickError(message)
            return null
        }

        val actualSize = if (file.length() > 0) file.length() else declaredSize
        if (!passesSizeBounds(index, actualSize, options)) {
            return null
        }

        BridgeUtils.logDebug(
            TAG,
            "Processing file with tri-transport: ${file.name} (${FileSizeRouterUtils.formatFileSize(actualSize)})"
        )

        val routingDecision = FileSizeRouterUtils.determineTransport(file)
        FileUtils.sendFilePickStateUpdate(webView, "routing")

        val processingResult = FileSizeRouterUtils.processFile(mainActivity, webView, routingDecision)
        if (!processingResult.success || processingResult.fileSrc == null) {
            val errorMsg = processingResult.error ?: "Unknown error processing file"
            BridgeUtils.logError(TAG, "File processing failed: $errorMsg")
            notifyFilePickError(errorMsg)
            return null
        }

        return JSONObject().apply {
            put("index", index)
            put("uri", uri.toString())
            put("fileName", processingResult.fileName)
            put("fileSrc", processingResult.fileSrc)
            put("filePath", processingResult.filePath)
            put("size", processingResult.fileSize)
            put("mimeType", processingResult.mimeType)
            put("transport", processingResult.transportUsed.name)
        }
    }

    private fun passesSizeBounds(index: Int, size: Long, options: FilePickerOptions): Boolean {
        if (size <= 0) return true

        options.minFileSize?.let { minSize ->
            if (size < minSize) {
                val formattedSize = FileSizeRouterUtils.formatFileSize(size)
                val minFormatted = FileSizeRouterUtils.formatFileSize(minSize)
                val message = "File ${index + 1} is too small ($formattedSize). Minimum size is $minFormatted."
                BridgeUtils.logWarning(TAG, message)
                notifyFilePickError(message)
                return false
            }
        }

        options.maxFileSize?.let { maxSize ->
            if (size > maxSize) {
                val formattedSize = FileSizeRouterUtils.formatFileSize(size)
                val maxFormatted = FileSizeRouterUtils.formatFileSize(maxSize)
                val message = "File ${index + 1} exceeds maximum size ($formattedSize > $maxFormatted)."
                BridgeUtils.logWarning(TAG, message)
                notifyFilePickError(message)
                return false
            }
        }

        return true
    }

    private fun validateFileSelectionCount(count: Int, options: FilePickerOptions): Boolean {
        options.minFiles?.let { min ->
            if (count < min) {
                val errorMessage = "Select at least $min file(s). You selected $count."
                BridgeUtils.logWarning(TAG, errorMessage)
                notifyFilePickError(errorMessage)
                return false
            }
        }

        options.maxFiles?.let { max ->
            if (count > max) {
                val errorMessage = "You can select up to $max file(s). You selected $count."
                BridgeUtils.logWarning(TAG, errorMessage)
                notifyFilePickError(errorMessage)
                return false
            }
        }

        return true
    }

    private fun sanitizeSelectionForSingleSelect(
        uris: List<Uri>,
        options: FilePickerOptions
    ): List<Uri> {
        if (options.multiple || uris.size <= 1) {
            return uris
        }

        BridgeUtils.logWarning(
            TAG,
            "Multiple files selected but picker configured for single selection. Only the first file will be processed."
        )
        return listOf(uris.first())
    }

    private fun notifyFilePickError(message: String) {
        BridgeUtils.notifyWebError(
            webView,
            BridgeUtils.WebEvents.ON_FILE_PICK_ERROR,
            message
        )
    }

    private fun launchFilePicker(options: FilePickerOptions) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_FILE_PICK_ERROR, "launch file picker") {
            val allowMultiple = options.multiple
            val intent = IntentUtils.createFilePickerIntent(options.mimeType, allowMultiple)
            BridgeUtils.logDebug(
                TAG,
                "Launching file picker with MIME type: ${options.mimeType}, allowMultiple: $allowMultiple"
            )
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
