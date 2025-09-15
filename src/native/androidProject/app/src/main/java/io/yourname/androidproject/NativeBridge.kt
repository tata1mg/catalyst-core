package io.yourname.androidproject

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import io.yourname.androidproject.MainActivity
import io.yourname.androidproject.utils.*
import kotlinx.coroutines.*

class NativeBridge(private val mainActivity: MainActivity, private val webView: WebView) : CoroutineScope {
    private var currentPhotoUri: Uri? = null
    private var shouldLaunchCameraAfterPermission = false

    // Coroutine scope for async operations
    private val supervisorJob = SupervisorJob()
    override val coroutineContext = Dispatchers.Main + supervisorJob

    // Input method manager for native keyboard handling
    private val inputMethodManager: InputMethodManager by lazy {
        mainActivity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as InputMethodManager
    }
    
    // Current overlay input field
    private var currentOverlayInput: EditText? = null

    private lateinit var cameraLauncher: ActivityResultLauncher<Uri>
    private lateinit var permissionLauncher: ActivityResultLauncher<String>
    private lateinit var filePickerLauncher: ActivityResultLauncher<Intent>

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
    fun showNativeInput(inputDataJson: String?) {
        BridgeUtils.safeExecute(webView, BridgeUtils.WebEvents.ON_NATIVE_INPUT_CANCELLED, "show native input") {
            mainActivity.runOnUiThread {
                BridgeUtils.logDebug(TAG, "showNativeInput called from JavaScript")
                BridgeUtils.logDebug(TAG, "Input data: $inputDataJson")

                if (inputDataJson.isNullOrBlank()) {
                    BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_NATIVE_INPUT_CANCELLED, "No input data provided")
                    return@runOnUiThread
                }

                try {
                    val inputData = parseInputData(inputDataJson)
                    showInputDialog(inputData, inputDataJson)
                } catch (e: Exception) {
                    BridgeUtils.logError(TAG, "Error parsing input data", e)
                    BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_NATIVE_INPUT_CANCELLED, "Invalid input data: ${e.message}")
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
     * Parse input data JSON from JavaScript
     */
    private fun parseInputData(inputDataJson: String): InputData {
        val jsonObject = org.json.JSONObject(inputDataJson)
        return InputData(
            id = jsonObject.getString("id"),
            type = jsonObject.optString("type", "text"),
            placeholder = jsonObject.optString("placeholder", ""),
            value = jsonObject.optString("value", ""),
            required = jsonObject.optBoolean("required", false),
            maxLength = if (jsonObject.has("maxLength") && !jsonObject.isNull("maxLength")) jsonObject.getInt("maxLength") else null,
            pattern = jsonObject.optString("pattern", null),
            min = jsonObject.optString("min", null),
            max = jsonObject.optString("max", null),
            step = jsonObject.optString("step", null)
        )
    }

    /**
     * Show native input overlay based on input type
     */
    private fun showInputDialog(inputData: InputData, inputDataJson: String) {
        when (inputData.type.lowercase()) {
            "text", "email", "password", "tel", "url", "number" -> showInputOverlay(inputDataJson)
            "date" -> showDatePickerDialog(inputData)
            "time" -> showTimePickerDialog(inputData)
            else -> showInputOverlay(inputDataJson) // Default fallback
        }
    }

    /**
     * Show native input overlay positioned over the web input field
     */
    private fun showInputOverlay(inputDataJson: String) {
        // Clear any existing overlay
        clearCurrentOverlay()
        
        // Parse the full input data JSON
        val inputDataObj = org.json.JSONObject(inputDataJson)
        val bounds = inputDataObj.getJSONObject("bounds")
        val style = inputDataObj.getJSONObject("style")
        
        // Parse basic input data
        val inputData = InputData(
            id = inputDataObj.getString("id"),
            type = inputDataObj.optString("type", "text"),
            placeholder = inputDataObj.optString("placeholder", ""),
            value = inputDataObj.optString("value", ""),
            required = inputDataObj.optBoolean("required", false),
            maxLength = if (inputDataObj.has("maxLength") && !inputDataObj.isNull("maxLength")) inputDataObj.getInt("maxLength") else null,
            pattern = inputDataObj.optString("pattern", null),
            min = inputDataObj.optString("min", null),
            max = inputDataObj.optString("max", null),
            step = inputDataObj.optString("step", null)
        )
        
        // Convert web coordinates to Android coordinates
        val androidBounds = convertWebCoordsToAndroid(
            bounds.getDouble("x"),
            bounds.getDouble("y"), 
            bounds.getDouble("width"),
            bounds.getDouble("height")
        )
        
        // Create overlay EditText
        val overlayEditText = EditText(mainActivity).apply {
            // Set content
            setText(inputData.value)
            hint = inputData.placeholder
            
            // Set input type based on field type
            inputType = when (inputData.type.lowercase()) {
                "email" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                "password" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                "tel" -> InputType.TYPE_CLASS_PHONE
                "url" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                "number" -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
                else -> InputType.TYPE_CLASS_TEXT
            }
            
            // Set constraints
            inputData.maxLength?.let { maxLength ->
                filters = arrayOf(android.text.InputFilter.LengthFilter(maxLength))
            }
            
            // Position and size to match web input
            x = androidBounds.x
            y = androidBounds.y
            layoutParams = FrameLayout.LayoutParams(androidBounds.width, androidBounds.height)
            
            // Apply web styling
            applyWebInputStyling(this, style)
            
            // Handle input completion
            setOnEditorActionListener { _, actionId, _ ->
                when (actionId) {
                    EditorInfo.IME_ACTION_DONE, EditorInfo.IME_ACTION_NEXT, EditorInfo.IME_ACTION_GO -> {
                        completeInput(inputData.id, text.toString(), inputData.type, inputData.required)
                        true
                    }
                    else -> false
                }
            }
            
            // Handle focus loss
            setOnFocusChangeListener { _, hasFocus ->
                if (!hasFocus) {
                    completeInput(inputData.id, text.toString(), inputData.type, inputData.required)
                }
            }
        }
        
        // Store reference and add to overlay
        currentOverlayInput = overlayEditText
        mainActivity.addInputOverlay(overlayEditText)
        
        // Show keyboard
        overlayEditText.requestFocus()
        inputMethodManager.showSoftInput(overlayEditText, InputMethodManager.SHOW_IMPLICIT)
        
        BridgeUtils.logDebug(TAG, "Native input overlay created for field: ${inputData.id}")
    }

    /**
     * Show date picker dialog
     */
    private fun showDatePickerDialog(inputData: InputData) {
        val calendar = java.util.Calendar.getInstance()
        
        // Parse existing value if present
        if (inputData.value.isNotEmpty()) {
            try {
                val parts = inputData.value.split("-")
                if (parts.size == 3) {
                    calendar.set(parts[0].toInt(), parts[1].toInt() - 1, parts[2].toInt())
                }
            } catch (e: Exception) {
                BridgeUtils.logWarning(TAG, "Could not parse existing date value: ${inputData.value}")
            }
        }

        val datePickerDialog = android.app.DatePickerDialog(
            mainActivity,
            { _, year, month, dayOfMonth ->
                val formattedDate = String.format("%04d-%02d-%02d", year, month + 1, dayOfMonth)
                sendInputValueToWebView(inputData.id, formattedDate, inputData.type)
            },
            calendar.get(java.util.Calendar.YEAR),
            calendar.get(java.util.Calendar.MONTH),
            calendar.get(java.util.Calendar.DAY_OF_MONTH)
        )

        datePickerDialog.setOnCancelListener {
            sendInputCancelledToWebView(inputData.id)
        }

        datePickerDialog.show()
    }

    /**
     * Show time picker dialog
     */
    private fun showTimePickerDialog(inputData: InputData) {
        val calendar = java.util.Calendar.getInstance()
        
        // Parse existing value if present
        if (inputData.value.isNotEmpty()) {
            try {
                val parts = inputData.value.split(":")
                if (parts.size >= 2) {
                    calendar.set(java.util.Calendar.HOUR_OF_DAY, parts[0].toInt())
                    calendar.set(java.util.Calendar.MINUTE, parts[1].toInt())
                }
            } catch (e: Exception) {
                BridgeUtils.logWarning(TAG, "Could not parse existing time value: ${inputData.value}")
            }
        }

        val timePickerDialog = android.app.TimePickerDialog(
            mainActivity,
            { _, hourOfDay, minute ->
                val formattedTime = String.format("%02d:%02d", hourOfDay, minute)
                sendInputValueToWebView(inputData.id, formattedTime, inputData.type)
            },
            calendar.get(java.util.Calendar.HOUR_OF_DAY),
            calendar.get(java.util.Calendar.MINUTE),
            true // 24-hour format
        )

        timePickerDialog.setOnCancelListener {
            sendInputCancelledToWebView(inputData.id)
        }

        timePickerDialog.show()
    }

    /**
     * Send input value back to WebView
     */
    private fun sendInputValueToWebView(fieldId: String, value: String, inputType: String) {
        val resultData = mapOf(
            "fieldId" to fieldId,
            "value" to value,
            "inputType" to inputType
        )
        
        BridgeUtils.logDebug(TAG, "Sending input value to WebView: $fieldId = $value")
        BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_NATIVE_INPUT_VALUE, 
            org.json.JSONObject(resultData).toString())
    }

    /**
     * Send input cancelled event to WebView
     */
    private fun sendInputCancelledToWebView(fieldId: String) {
        val resultData = mapOf(
            "fieldId" to fieldId
        )
        
        BridgeUtils.logDebug(TAG, "Sending input cancelled to WebView: $fieldId")
        BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.ON_NATIVE_INPUT_CANCELLED, 
            org.json.JSONObject(resultData).toString())
    }

    /**
     * Convert web coordinates to Android view coordinates
     */
    private fun convertWebCoordsToAndroid(webX: Double, webY: Double, webWidth: Double, webHeight: Double): AndroidBounds {
        // Get WebView's position in the activity
        val webViewLocation = IntArray(2)
        webView.getLocationOnScreen(webViewLocation)
        
        // Get density for coordinate conversion
        val density = mainActivity.resources.displayMetrics.density
        
        return AndroidBounds(
            x = (webX * density + webViewLocation[0]).toFloat(),
            y = (webY * density + webViewLocation[1]).toFloat(),
            width = (webWidth * density).toInt(),
            height = (webHeight * density).toInt()
        )
    }
    
    /**
     * Apply web input styling to native EditText
     */
    private fun applyWebInputStyling(editText: EditText, webStyle: org.json.JSONObject) {
        try {
            editText.apply {
                // Font size
                val fontSize = parseSizeValue(webStyle.optString("fontSize", "16px"))
                setTextSize(TypedValue.COMPLEX_UNIT_PX, fontSize)
                
                // Text color
                val textColor = parseColorValue(webStyle.optString("color", "#000000"))
                setTextColor(textColor)
                
                // Background and border
                val background = createMatchingBackground(webStyle)
                setBackground(background)
                
                // Text alignment
                gravity = when (webStyle.optString("textAlign", "left")) {
                    "center" -> Gravity.CENTER
                    "right" -> Gravity.END
                    else -> Gravity.START
                }
                
                // Padding
                val paddingLeft = parseSizeValue(webStyle.optString("paddingLeft", "0px")).toInt()
                val paddingTop = parseSizeValue(webStyle.optString("paddingTop", "0px")).toInt()
                val paddingRight = parseSizeValue(webStyle.optString("paddingRight", "0px")).toInt()
                val paddingBottom = parseSizeValue(webStyle.optString("paddingBottom", "0px")).toInt()
                
                setPadding(paddingLeft, paddingTop, paddingRight, paddingBottom)
            }
        } catch (e: Exception) {
            BridgeUtils.logWarning(TAG, "Error applying web styling: ${e.message}")
        }
    }
    
    /**
     * Create background drawable matching web input styling
     */
    private fun createMatchingBackground(webStyle: org.json.JSONObject): GradientDrawable {
        val drawable = GradientDrawable()
        
        try {
            // Background color
            val bgColor = parseColorValue(webStyle.optString("backgroundColor", "#FFFFFF"))
            drawable.setColor(bgColor)
            
            // Border
            val borderWidth = parseSizeValue(webStyle.optString("borderWidth", "1px")).toInt()
            val borderColor = parseColorValue(webStyle.optString("borderColor", "#CCCCCC"))
            drawable.setStroke(borderWidth, borderColor)
            
            // Border radius
            val borderRadius = parseSizeValue(webStyle.optString("borderRadius", "0px"))
            drawable.cornerRadius = borderRadius
            
        } catch (e: Exception) {
            BridgeUtils.logWarning(TAG, "Error creating background: ${e.message}")
            // Fallback to default styling
            drawable.setColor(Color.WHITE)
            drawable.setStroke(2, Color.GRAY)
            drawable.cornerRadius = 8f
        }
        
        return drawable
    }
    
    /**
     * Parse CSS size value to pixels
     */
    private fun parseSizeValue(cssValue: String): Float {
        return try {
            when {
                cssValue.endsWith("px") -> cssValue.dropLast(2).toFloat()
                cssValue.endsWith("dp") -> cssValue.dropLast(2).toFloat() * mainActivity.resources.displayMetrics.density
                cssValue.endsWith("sp") -> cssValue.dropLast(2).toFloat() * mainActivity.resources.displayMetrics.scaledDensity
                else -> cssValue.toFloatOrNull() ?: 16f
            }
        } catch (e: Exception) {
            16f // Default fallback
        }
    }
    
    /**
     * Parse CSS color value to Android Color
     */
    private fun parseColorValue(cssColor: String): Int {
        return try {
            when {
                cssColor.startsWith("#") -> Color.parseColor(cssColor)
                cssColor.startsWith("rgb(") -> {
                    val rgb = cssColor.substring(4, cssColor.length - 1).split(",")
                    Color.rgb(rgb[0].trim().toInt(), rgb[1].trim().toInt(), rgb[2].trim().toInt())
                }
                cssColor.startsWith("rgba(") -> {
                    val rgba = cssColor.substring(5, cssColor.length - 1).split(",")
                    Color.argb(
                        (rgba[3].trim().toFloat() * 255).toInt(),
                        rgba[0].trim().toInt(),
                        rgba[1].trim().toInt(),
                        rgba[2].trim().toInt()
                    )
                }
                else -> Color.BLACK // Default fallback
            }
        } catch (e: Exception) {
            Color.BLACK
        }
    }
    
    /**
     * Complete input and send value back to WebView
     */
    private fun completeInput(fieldId: String, value: String, inputType: String, required: Boolean) {
        // Basic validation
        if (required && value.isEmpty()) {
            BridgeUtils.notifyWebError(webView, BridgeUtils.WebEvents.ON_NATIVE_INPUT_CANCELLED, "Required field cannot be empty")
            clearCurrentOverlay()
            return
        }
        
        // Send value back to WebView
        sendInputValueToWebView(fieldId, value, inputType)
        
        // Clear overlay
        clearCurrentOverlay()
    }
    
    /**
     * Clear current input overlay
     */
    private fun clearCurrentOverlay() {
        currentOverlayInput?.let { overlay ->
            mainActivity.removeInputOverlay(overlay)
            inputMethodManager.hideSoftInputFromWindow(overlay.windowToken, 0)
        }
        currentOverlayInput = null
    }
    
    /**
     * Data class for Android coordinate bounds
     */
    data class AndroidBounds(
        val x: Float,
        val y: Float,
        val width: Int,
        val height: Int
    )
    
    /**
     * Data class for input field information
     */
    data class InputData(
        val id: String,
        val type: String,
        val placeholder: String,
        val value: String,
        val required: Boolean,
        val maxLength: Int?,
        val pattern: String?,
        val min: String?,
        val max: String?,
        val step: String?
    )

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