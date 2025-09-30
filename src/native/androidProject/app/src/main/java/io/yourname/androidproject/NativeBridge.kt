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
import androidx.core.app.NotificationCompat
import io.yourname.androidproject.MainActivity
import io.yourname.androidproject.utils.*
import kotlinx.coroutines.*

class NativeBridge(
    private val mainActivity: MainActivity,
    private val webView: WebView
) : CoroutineScope {
    private var currentPhotoUri: Uri? = null
    private var shouldLaunchCameraAfterPermission = false

    // Coroutine scope for async operations
    private val supervisorJob = SupervisorJob()
    override val coroutineContext = Dispatchers.Main + supervisorJob

    private lateinit var cameraLauncher: ActivityResultLauncher<Uri>
    private lateinit var permissionLauncher: ActivityResultLauncher<String>
    private lateinit var filePickerLauncher: ActivityResultLauncher<Intent>

    // Unified notification manager
    private val notificationManager = NotificationManager(mainActivity, mainActivity.properties)

    companion object {
        private const val TAG = "NativeBridge"
    }

    init {
        try {
            initializeCameraLauncher()
            initializePermissionLauncher()
            initializeFilePickerLauncher()

            // Initialize FrameworkServer for large file handling
            initializeFrameworkServer()

            // Initialize NotificationManager and set WebView reference
            notificationManager.initialize()
            notificationManager.setWebViewReference(webView)
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
    
    @JavascriptInterface
    fun scheduleLocalNotification(config: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.LOCAL_NOTIFICATION_SCHEDULED, "schedule local notification") {
            mainActivity.runOnUiThread {
                // Parse config with full NotificationConfig support
                val notificationConfig = if (config.isNullOrBlank()) {
                    NotificationConfig(title = "Notification", body = "You have a new message")
                } else {
                    try {
                        val json = org.json.JSONObject(config)

                        // Parse actions array with title and actionId
                        val actions = if (json.has("actions")) {
                            val actionsArray = json.getJSONArray("actions")
                            val actionsList = mutableListOf<NotificationAction>()
                            for (i in 0 until actionsArray.length()) {
                                val actionObj = actionsArray.getJSONObject(i)
                                actionsList.add(
                                    NotificationAction(
                                        title = actionObj.getString("title"),
                                        actionId = actionObj.getString("action")
                                    )
                                )
                            }
                            actionsList
                        } else null

                        // Parse data map if present - support Any type
                        val data = if (json.has("data")) {
                            val dataObj = json.getJSONObject("data")
                            val dataMap = mutableMapOf<String, Any>()
                            dataObj.keys().forEach { key ->
                                dataMap[key] = dataObj.get(key)
                            }
                            dataMap
                        } else null

                        // Parse style enum if present
                        val style = if (json.has("style")) {
                            try {
                                NotificationStyle.valueOf(json.getString("style"))
                            } catch (e: IllegalArgumentException) {
                                NotificationStyle.BASIC
                            }
                        } else NotificationStyle.BASIC

                        NotificationConfig(
                            title = json.optString("title", "Notification"),
                            body = json.optString("body", "You have a new message"),
                            channel = json.optString("channel", "default"),
                            badge = if (json.has("badge")) json.getInt("badge") else null,
                            actions = actions,
                            largeImage = json.optString("largeImage", null),
                            style = style,
                            priority = json.optInt("priority", NotificationCompat.PRIORITY_DEFAULT),
                            vibrate = json.optBoolean("vibrate", true),
                            autoCancel = json.optBoolean("autoCancel", true),
                            ongoing = json.optBoolean("ongoing", false),
                            data = data
                        )
                    } catch (e: Exception) {
                        BridgeUtils.logError(TAG, "Error parsing notification config", e)
                        NotificationConfig(title = "Notification", body = "You have a new message")
                    }
                }
                
                val notificationId = notificationManager.scheduleLocal(notificationConfig)
                BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.LOCAL_NOTIFICATION_SCHEDULED,
                    """{"notificationId": "$notificationId", "scheduled": true}""")
            }
        }
    }

    @JavascriptInterface
    fun cancelLocalNotification(notificationId: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.LOCAL_NOTIFICATION_SCHEDULED, "cancel local notification") {
            mainActivity.runOnUiThread {
                val success = notificationManager.cancelLocal(notificationId)
                BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.LOCAL_NOTIFICATION_SCHEDULED,
                    """{"notificationId": "$notificationId", "cancelled": $success}""")
            }
        }
    }

    @JavascriptInterface
    fun requestNotificationPermission(config: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.NOTIFICATION_PERMISSION_STATUS, "request notification permission") {
            mainActivity.runOnUiThread {
                notificationManager.requestPermission(mainActivity) { granted ->
                    val status = if (granted) "GRANTED" else "DENIED"
                    BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_PERMISSION_STATUS, status)
                }
            }
        }
    }

    @JavascriptInterface
    fun registerForPushNotifications(config: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.PUSH_NOTIFICATION_TOKEN, "register for push notifications") {
            mainActivity.runOnUiThread {
                launch {
                    try {
                        val token = notificationManager.initializePush()
                        BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.PUSH_NOTIFICATION_TOKEN,
                            """{"token": "$token", "registered": true}""")
                    } catch (e: Exception) {
                        BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.PUSH_NOTIFICATION_TOKEN,
                            "Push registration failed: ${e.message}")
                    }
                }
            }
        }
    }


    @JavascriptInterface
    fun subscribeToTopic(config: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED, "subscribe to topic") {
            mainActivity.runOnUiThread {
                launch {
                    try {
                        val json = org.json.JSONObject(config ?: "{}")
                        val topic = json.optString("topic", "")

                        if (topic.isBlank()) {
                            BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED,
                                "Topic name cannot be empty")
                            return@launch
                        }

                        val success = notificationManager.subscribeToTopic(topic)
                        BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED,
                            """{"topic": "$topic", "subscribed": $success}""")

                    } catch (e: Exception) {
                        BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED,
                            "Topic subscription failed: ${e.message}")
                    }
                }
            }
        }
    }

    @JavascriptInterface
    fun unsubscribeFromTopic(config: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED, "unsubscribe from topic") {
            mainActivity.runOnUiThread {
                launch {
                    try {
                        val json = org.json.JSONObject(config ?: "{}")
                        val topic = json.optString("topic", "")

                        if (topic.isBlank()) {
                            BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED,
                                "Topic name cannot be empty")
                            return@launch
                        }

                        val success = notificationManager.unsubscribeFromTopic(topic)
                        BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED,
                            """{"topic": "$topic", "unsubscribed": $success}""")

                    } catch (e: Exception) {
                        BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED,
                            "Topic unsubscription failed: ${e.message}")
                    }
                }
            }
        }
    }

    @JavascriptInterface
    fun getSubscribedTopics(config: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED, "get subscribed topics") {
            mainActivity.runOnUiThread {
                try {
                    val topics = notificationManager.getSubscribedTopics()
                    val topicsArray = org.json.JSONArray(topics.toList())
                    BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED,
                        """{"topics": $topicsArray}""")

                } catch (e: Exception) {
                    BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.NOTIFICATION_RECEIVED,
                        "Failed to get subscribed topics: ${e.message}")
                }
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
     * Handle permission request results
     */
    fun handlePermissionResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.NOTIFICATION_PERMISSION_STATUS, "handle permission result") {
            // Delegate to notification manager which handles notification permissions
            notificationManager.getNotificationUtils().handlePermissionResult(requestCode, permissions, grantResults)
        }
    }

    /**
     * Cleanup method to be called when the bridge is being destroyed
     */
    fun cleanup() {
        BridgeUtils.logDebug(TAG, "Cleaning up NativeBridge resources")

        try {
            // Cleanup NotificationManager
            notificationManager.cleanup()

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