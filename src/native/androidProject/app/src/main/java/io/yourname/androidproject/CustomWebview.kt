package io.yourname.androidproject

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import androidx.webkit.WebViewAssetLoader
import io.yourname.androidproject.WebCacheManager
import io.yourname.androidproject.isUrlAllowed
import io.yourname.androidproject.isExternalDomain
import kotlinx.coroutines.*
import java.util.Properties

class CustomWebView(
    private val context: Context,
    private val webView: WebView,
    private val progressBar: ProgressBar,
    private val properties: Properties
) : CoroutineScope {

    private val TAG = "WebViewDebug"
    private val job = SupervisorJob()
    override val coroutineContext = Dispatchers.Main + job

    private var cacheManager: WebCacheManager
    private var buildType: String = "debug"  // Default to debug
    private var cachePatterns: List<String> = emptyList()
    private var isHardwareAccelerationEnabled = false
    private var apiBaseUrl: String = ""
    private var isInitialApiCalled: Boolean = false  // Flag to track initial page load
    private var isInitialPageLoaded: Boolean = false
    private var buildOptimisation: Boolean = false // Added property for build optimization
    private lateinit var assetLoader: WebViewAssetLoader
    private var allowedUrls: List<String> = emptyList()
    private var accessControlEnabled: Boolean = false

    // Counters for asset loading statistics
    private var assetLoadAttempts = 0
    private var assetLoadFailures = 0
    
    // Keyboard and scroll handling
    private var isKeyboardVisible = false
    private var keyboardHeight = 0
    private var focusedInputId: String? = null

    init {
        cacheManager = WebCacheManager(context)
        setupFromProperties()
        setupWebView()
        setupNativeInputInterception()
        setupScrollAndViewportHandling()
    }

    private fun setupFromProperties() {
        buildType = properties.getProperty("buildType", "debug")
        apiBaseUrl = properties.getProperty("apiBaseUrl", "")
        cachePatterns = properties.getProperty("cachePattern", "")
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        // Parse buildOptimisation property
        buildOptimisation = properties.getProperty("buildOptimisation", "false").toBoolean()

        // Load access control settings from properties
        accessControlEnabled = properties.getProperty("accessControl.enabled", "false").toBoolean()
        allowedUrls = properties.getProperty("accessControl.allowedUrls", "")
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        // Set initial flags based on buildOptimisation
        if (buildOptimisation) {
            isInitialApiCalled = false
            isInitialPageLoaded = false
        } else {
            isInitialApiCalled = false  // Default value
            isInitialPageLoaded = false // Default value
        }

        // Only log detailed info in debug mode
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Build type: $buildType")
            Log.d(TAG, "Cache Pattern: $cachePatterns")
            Log.d(TAG, "API Base URL: $apiBaseUrl")
            Log.d(TAG, "Build Optimisation: $buildOptimisation")
            Log.d(TAG, "Access Control Enabled: $accessControlEnabled")
            Log.d(TAG, "Allowed URLs: $allowedUrls")
            Log.d(TAG, "Initial API Called: $isInitialApiCalled")
            Log.d(TAG, "Initial Page Loaded: $isInitialPageLoaded")
        }

        // Setup WebView Asset Loader for serving local files
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .addPathHandler("/res/", WebViewAssetLoader.ResourcesPathHandler(context))
            .build()
    }

    fun loadUrl(url: String) {
        webView.loadUrl(url)
    }

    fun saveState(outState: Bundle) {
        webView.saveState(outState)
    }

    fun restoreState(savedInstanceState: Bundle) {
        webView.restoreState(savedInstanceState)
    }

    fun clearCache() {
        webView.clearCache(false)
        webView.clearHistory()
    }

    fun canGoBack(): Boolean = webView.canGoBack()

    fun goBack() {
        webView.goBack()
    }

    fun onPause() {
        webView.onPause()
    }

    fun onResume() {
        webView.onResume()
    }

    fun getWebView(): WebView {
        return webView
    }

    @SuppressLint("JavascriptInterface")
    fun addJavascriptInterface(obj: Any, name: String) {
        // Check if we're on API 17 or higher
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.JELLY_BEAN_MR1) {
            // Verify that the object has at least one method annotated with @JavascriptInterface
            val hasAnnotatedMethods = obj.javaClass.declaredMethods.any {
                it.isAnnotationPresent(android.webkit.JavascriptInterface::class.java)
            }

            if (!hasAnnotatedMethods) {
                Log.e(TAG, "Error: No methods in ${obj.javaClass.simpleName} are annotated with @JavascriptInterface")
            }
        }

        webView.addJavascriptInterface(obj, name)
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "🔗 Added JavaScript interface: $name")
        }
    }

    fun destroy() {
        job.cancel()
        webView.destroy()
    }

    fun cleanupCache() {
        launch(Dispatchers.IO) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "📝 Starting cache cleanup on thread: ${Thread.currentThread().name}")
            }
            val startTime = System.currentTimeMillis()
            disableHardwareAcceleration()
            try {
                cacheManager.cleanup()
                if (BuildConfig.DEBUG) {
                    val duration = System.currentTimeMillis() - startTime
                    Log.d(TAG, "⏱️ Cache cleanup completed in ${duration}ms on thread: ${Thread.currentThread().name}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Cache cleanup error: ${e.message}")
            } finally {
                enableHardwareAcceleration()
            }
        }
    }

    fun enableHardwareAcceleration() {
        if (!isHardwareAccelerationEnabled) {
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isHardwareAccelerationEnabled = true
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "🚀 Hardware acceleration enabled - Thread: ${Thread.currentThread().name}")
            }
        }
    }

    fun disableHardwareAcceleration() {
        if (isHardwareAccelerationEnabled) {
            webView.setLayerType(View.LAYER_TYPE_NONE, null)
            isHardwareAccelerationEnabled = false
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "⚫ Hardware acceleration disabled - Thread: ${Thread.currentThread().name}")
            }
        }
    }

    private fun shouldCacheUrl(url: String): Boolean {
        if (cachePatterns.isEmpty()) return false

        fun String.wildcardToRegex(): String {
            return this.replace(".", "\\.")
                .replace("*", ".*")
                .let { "^$it$" }
        }

        return cachePatterns.any { pattern ->
            val regex = pattern.wildcardToRegex().toRegex(RegexOption.IGNORE_CASE)
            regex.matches(url) || url.endsWith(pattern.removePrefix("*"))
        }
    }



    private fun openInInAppBrowser(url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "🌐 Opening external URL in in-app browser: $url")
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to open URL in in-app browser: $url", e)
        }
    }
    

    private fun isApiCall(url: String): Boolean {
        // Check if URL is an API call based on your API base URL
        return apiBaseUrl.isNotEmpty() && url.startsWith(apiBaseUrl)
    }

    private fun isStaticResourceRequest(url: String): Boolean {
        // Check if this is a static resource (JS, CSS, images, etc.)
        val extensions = listOf(".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2", ".ttf", ".eot")

        // Don't try to intercept API calls
        if (isApiCall(url)) {
            return false
        }

        return extensions.any { url.endsWith(it) }
    }

    private fun extractAssetPath(url: String): String {
        // Convert a URL to an asset path
        val uri = Uri.parse(url)
        val path = uri.path ?: ""

        // Remove leading slash if present
        var cleanPath = if (path.startsWith("/")) path.substring(1) else path

        // If path is empty or just "/", return index.html
        if (cleanPath.isEmpty()) {
            return "build/public/index.html"
        }

        // Special case for favicon.ico which might be in root
        if (cleanPath == "favicon.ico") {
            return "build/public/favicon.ico"
        }

        // Extract just the filename portion, ignoring any directory structure
        val fileName = cleanPath.substringAfterLast("/")

        // Always look directly in build/public for the file, regardless of the URL path
        return "build/public/$fileName"
    }

    private fun getMimeType(path: String): String {
        return when {
            path.endsWith(".html") -> "text/html"
            path.endsWith(".js") -> "application/javascript"
            path.endsWith(".css") -> "text/css"
            path.endsWith(".json") -> "application/json"
            path.endsWith(".png") -> "image/png"
            path.endsWith(".jpg") -> "image/jpeg"
            path.endsWith(".jpeg") -> "image/jpeg"
            path.endsWith(".gif") -> "image/gif"
            path.endsWith(".svg") -> "image/svg+xml"
            path.endsWith(".woff") -> "font/woff"
            path.endsWith(".woff2") -> "font/woff2"
            path.endsWith(".ttf") -> "font/ttf"
            path.endsWith(".eot") -> "application/vnd.ms-fontobject"
            else -> "application/octet-stream"
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "🌐 Setting up WebView on thread: ${Thread.currentThread().name}")
        }

        webView.settings.apply {
            javaScriptEnabled = true
            loadsImagesAutomatically = true
            mixedContentMode = if (BuildConfig.ALLOW_MIXED_CONTENT) {
                WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            } else {
                WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }

            setRenderPriority(WebSettings.RenderPriority.HIGH)
            cacheMode = WebSettings.LOAD_DEFAULT
            databaseEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            setEnableSmoothTransition(true)

            // Allow access to file URLs and JavaScript interfaces - restrict in production if possible
            allowFileAccessFromFileURLs = BuildConfig.DEBUG 
            allowUniversalAccessFromFileURLs = BuildConfig.DEBUG
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                request?.url?.let { url ->
                    val urlString = url.toString()
                    
                    if (accessControlEnabled) {
                        // Check if URL is an external domain
                        if (url.scheme in listOf("http", "https") && isExternalDomain(urlString, allowedUrls)) {
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "🌍 External domain detected, opening in in-app browser: $urlString")
                            }
                            openInInAppBrowser(urlString)
                            return true
                        }
                        
                        // Check if URL is allowed for internal navigation
                        if (!isUrlAllowed(urlString, allowedUrls)) {
                            if (BuildConfig.DEBUG) {
                                Log.w(TAG, "🚫 URL blocked by access control: $urlString")
                            }
                            return true
                        }
                    }
                    
                    // Let WebView handle loading non-API HTTP/HTTPS URLs
                    if (url.scheme in listOf("http", "https")) {
                        return false
                    }
                }
                return false
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url.toString()
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "🔄 Intercepting request for: $url on thread: ${Thread.currentThread().name}")
                }

                if (accessControlEnabled && !isUrlAllowed(url, allowedUrls)) {
                    if (BuildConfig.DEBUG) {
                        Log.w(TAG, "🚫 Network request blocked by access control: $url")
                    }
                    // Return an empty response to block the request
                    return WebResourceResponse("text/plain", "utf-8", null)
                }

                // Handle the initial route request - intercept first request regardless of host
                if (!isInitialApiCalled && request.method == "GET") {
                    isInitialApiCalled = true
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "📄 Serving initial index.html from assets for route: $url")
                    }

                    try {
                        val indexHtml = context.assets.open("build/public/index.html")
                        return WebResourceResponse(
                            "text/html",
                            "utf-8",
                            indexHtml
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ Error loading index.html from assets", e)
                    }
                }

                if(!isInitialPageLoaded) {
                    // Check if this is a static resource that should be loaded from assets
                    if (request.method == "GET" && isStaticResourceRequest(url)) {
                        val assetPath = extractAssetPath(url)
                        assetLoadAttempts++

                        try {
                            val mimeType = getMimeType(assetPath)
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "📦 Attempting to serve from assets: $assetPath")
                            }
                            val inputStream = context.assets.open(assetPath)
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "✅ Successfully loaded from assets: $assetPath")
                            }
                            return WebResourceResponse(mimeType, "utf-8", inputStream)
                        } catch (e: Exception) {
                            assetLoadFailures++
                            if (BuildConfig.DEBUG) {
                                Log.e(TAG, "❌ Error loading asset: $assetPath", e)
                                Log.d(TAG, "⚠️ Falling back to network for: $url")
                            }
                            // Return null to let the WebView load from network
                            return null
                        }
                    }

                    // Let API calls go through normally
                    if (isApiCall(url)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "🌐 API call detected, letting it go through network: $url")
                        }
                        return null
                    }
                }

                // For non-API HTTP requests that match cache patterns, use cache system
                if (request.method == "GET" && shouldCacheUrl(url)) {
                    return runBlocking {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "⚙️ Processing cacheable request in coroutine on thread: ${Thread.currentThread().name}")
                        }
                        val startTime = System.currentTimeMillis()
                        disableHardwareAcceleration()
                        try {
                            val headers = request.requestHeaders.toMutableMap().apply {
                                if (!containsKey("Cache-Control")) {
                                    put("Cache-Control", "max-age=86400")
                                }
                                if (!containsKey("Pragma")) {
                                    put("Pragma", "cache")
                                }
                            }

                            var response = cacheManager.getCachedResponse(url, headers)

                            if (response != null) {
                                if (BuildConfig.DEBUG) {
                                    val duration = System.currentTimeMillis() - startTime
                                    Log.d(TAG, "✅ Served from cache in ${duration}ms: $url")
                                }
                                response
                            } else {
                                if (BuildConfig.DEBUG) {
                                    Log.d(TAG, "❌ Cache miss for: $url")
                                }
                                null
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Error processing request for URL: $url: ${e.message}")
                            if (BuildConfig.DEBUG) {
                                e.printStackTrace()
                            }
                            null
                        } finally {
                            enableHardwareAcceleration()
                        }
                    }
                } else {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "⏭️ URL doesn't match cache criteria, skipping cache: $url")
                    }
                }

                return null
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
                val startTime = System.currentTimeMillis()
                view?.tag = startTime // Store start time for performance tracking
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "⏳ Page load started for: $url - Hardware Acceleration: $isHardwareAccelerationEnabled")
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progressBar.visibility = View.GONE
                if(!isInitialPageLoaded){
                    isInitialPageLoaded = true
                }
                if (BuildConfig.DEBUG) {
                    val startTime = view?.tag as? Long ?: return
                    val loadTime = System.currentTimeMillis() - startTime
                    Log.d(TAG, "✅ Page load finished for: $url - Load time: ${loadTime}ms - Hardware Acceleration: $isHardwareAccelerationEnabled")
                    Log.d(TAG, "📊 Asset loading stats: Attempted: $assetLoadAttempts, Failed: $assetLoadFailures (${String.format("%.1f", assetLoadFailures * 100.0 / assetLoadAttempts.coerceAtLeast(1))}%)")
                }
                
                // Inject viewport and scroll configuration
                injectViewportAndScrollConfiguration()
                
                super.onPageFinished(view, url)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (error != null) {
                    Log.e(TAG, "❌ Error loading ${request?.url}: ${error.errorCode} ${error.description}")
                    
                    // Only show a fallback page for main frame errors in production
                    if (request?.isForMainFrame == true && !BuildConfig.DEBUG) {
                        try {
                            view?.loadUrl("file:///android_asset/build/public/error.html")
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to load error page: ${e.message}")
                        }
                    }
                }
                super.onReceivedError(view, request, error)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, progress: Int) {
                progressBar.progress = progress
                if (progress == 100) {
                    progressBar.visibility = View.GONE
                }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Console: ${consoleMessage?.message()} -- From line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                }
                return true
            }
        }

        // Only enable WebView debugging in debug builds
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    }

    /**
     * Setup native input interception without WebBridge dependency
     */
    private fun setupNativeInputInterception() {
        // Disable WebView's built-in input handling
        webView.settings.setNeedInitialFocus(false)
        
        // Set up touch event interception
        webView.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_DOWN) {
                val x = event.x
                val y = event.y
                
                // Check if touch hit an input field
                checkForInputFieldAtPosition(x, y)
            }
            false // Don't consume the event
        }
        
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Native input interception setup completed")
        }
    }

    /**
     * Check if touch position hits an input field and handle native input
     */
    private fun checkForInputFieldAtPosition(x: Float, y: Float) {
        val js = """
            (function() {
                const element = document.elementFromPoint($x, $y);
                if (element && ['INPUT', 'TEXTAREA'].includes(element.tagName)) {
                    // Skip if explicitly disabled
                    if (element.dataset.nativeInput === 'false') {
                        return null;
                    }
                    
                    // Skip readonly and disabled fields
                    if (element.readOnly || element.disabled) {
                        return null;
                    }
                    
                    // Ensure element has ID
                    if (!element.id) {
                        element.id = 'native-input-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                    }
                    
                    const rect = element.getBoundingClientRect();
                    return JSON.stringify({
                        id: element.id,
                        type: element.type || 'text',
                        placeholder: element.placeholder || '',
                        value: element.value || '',
                        required: element.required || false,
                        maxLength: element.maxLength > 0 ? element.maxLength : null,
                        bounds: {
                            x: rect.left,
                            y: rect.top,
                            width: rect.width,
                            height: rect.height
                        }
                    });
                }
                return null;
            })();
        """
        
        webView.evaluateJavascript(js) { result ->
            if (result != null && result != "null") {
                handleNativeInputRequestWithFocus(result.removeSurrounding("\""))
            }
        }
    }

    /**
     * Handle native input request without WebBridge
     */
    private fun handleNativeInputRequest(inputDataJson: String) {
        try {
            val inputData = org.json.JSONObject(inputDataJson)
            val fieldId = inputData.getString("id")
            val inputType = inputData.optString("type", "text")
            
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Native input requested for field: $fieldId, type: $inputType")
            }
            
            // Hide the web input field
            hideWebInputField(fieldId)
            
            // Show native input based on type
            when (inputType.lowercase()) {
                "date" -> showNativeDatePicker(inputData)
                "time" -> showNativeTimePicker(inputData)
                else -> showNativeTextInput(inputData)
            }
            
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) {
                Log.e(TAG, "Error handling native input request", e)
            }
        }
    }

    /**
     * Hide web input field during native input
     */
    private fun hideWebInputField(fieldId: String) {
        val js = """
            (function() {
                const field = document.getElementById('$fieldId');
                if (field) {
                    field.style.opacity = '0';
                    field.style.pointerEvents = 'none';
                    field.blur();
                }
            })();
        """
        webView.evaluateJavascript(js, null)
    }

    /**
     * Restore web input field visibility
     */
    private fun restoreWebInputField(fieldId: String) {
        val js = """
            (function() {
                const field = document.getElementById('$fieldId');
                if (field) {
                    field.style.opacity = '';
                    field.style.pointerEvents = '';
                }
            })();
        """
        webView.evaluateJavascript(js, null)
    }

    /**
     * Update web input field with native input value
     */
    private fun updateWebInputField(fieldId: String, value: String) {
        val js = """
            (function() {
                const field = document.getElementById('$fieldId');
                if (field) {
                    field.value = '$value';
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                    field.style.opacity = '';
                    field.style.pointerEvents = '';
                }
            })();
        """
        webView.evaluateJavascript(js, null)
    }

    /**
     * Show native text input dialog
     */
    private fun showNativeTextInput(inputData: org.json.JSONObject) {
        val fieldId = inputData.getString("id")
        val inputType = inputData.optString("type", "text")
        val placeholder = inputData.optString("placeholder", "")
        val currentValue = inputData.optString("value", "")
        val required = inputData.optBoolean("required", false)
        
        val editText = android.widget.EditText(context).apply {
            setText(currentValue)
            hint = placeholder
            
            // Set appropriate input type
            this.inputType = when (inputType.lowercase()) {
                "email" -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                "password" -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                "tel" -> android.text.InputType.TYPE_CLASS_PHONE
                "url" -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
                "number" -> android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
                else -> android.text.InputType.TYPE_CLASS_TEXT
            }
        }

        val dialog = android.app.AlertDialog.Builder(context)
            .setTitle("Enter ${placeholder.ifEmpty { "value" }}")
            .setView(editText)
            .setPositiveButton("OK") { _, _ ->
                val enteredValue = editText.text.toString()
                
                if (required && enteredValue.isEmpty()) {
                    restoreWebInputField(fieldId)
                    return@setPositiveButton
                }
                
                updateWebInputFieldWithFocus(fieldId, enteredValue)
            }
            .setNegativeButton("Cancel") { _, _ ->
                restoreWebInputField(fieldId)
            }
            .setOnCancelListener {
                restoreWebInputField(fieldId)
            }
            .create()

        dialog.show()
        
        // Show keyboard
        dialog.setOnShowListener {
            val inputMethodManager = context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
            inputMethodManager.showSoftInput(editText, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
        }
    }

    /**
     * Show native date picker
     */
    private fun showNativeDatePicker(inputData: org.json.JSONObject) {
        val fieldId = inputData.getString("id")
        val currentValue = inputData.optString("value", "")
        
        val calendar = java.util.Calendar.getInstance()
        
        // Parse existing value if present
        if (currentValue.isNotEmpty()) {
            try {
                val parts = currentValue.split("-")
                if (parts.size == 3) {
                    calendar.set(parts[0].toInt(), parts[1].toInt() - 1, parts[2].toInt())
                }
            } catch (e: Exception) {
                if (BuildConfig.DEBUG) {
                    Log.w(TAG, "Could not parse date value: $currentValue")
                }
            }
        }

        val datePickerDialog = android.app.DatePickerDialog(
            context,
            { _, year, month, dayOfMonth ->
                val formattedDate = String.format("%04d-%02d-%02d", year, month + 1, dayOfMonth)
                updateWebInputFieldWithFocus(fieldId, formattedDate)
            },
            calendar.get(java.util.Calendar.YEAR),
            calendar.get(java.util.Calendar.MONTH),
            calendar.get(java.util.Calendar.DAY_OF_MONTH)
        )

        datePickerDialog.setOnCancelListener {
            restoreWebInputField(fieldId)
        }

        datePickerDialog.show()
    }

    /**
     * Show native time picker
     */
    private fun showNativeTimePicker(inputData: org.json.JSONObject) {
        val fieldId = inputData.getString("id")
        val currentValue = inputData.optString("value", "")
        
        val calendar = java.util.Calendar.getInstance()
        
        // Parse existing value if present
        if (currentValue.isNotEmpty()) {
            try {
                val parts = currentValue.split(":")
                if (parts.size >= 2) {
                    calendar.set(java.util.Calendar.HOUR_OF_DAY, parts[0].toInt())
                    calendar.set(java.util.Calendar.MINUTE, parts[1].toInt())
                }
            } catch (e: Exception) {
                if (BuildConfig.DEBUG) {
                    Log.w(TAG, "Could not parse time value: $currentValue")
                }
            }
        }

        val timePickerDialog = android.app.TimePickerDialog(
            context,
            { _, hourOfDay, minute ->
                val formattedTime = String.format("%02d:%02d", hourOfDay, minute)
                updateWebInputFieldWithFocus(fieldId, formattedTime)
            },
            calendar.get(java.util.Calendar.HOUR_OF_DAY),
            calendar.get(java.util.Calendar.MINUTE),
            true // 24-hour format
        )

        timePickerDialog.setOnCancelListener {
            restoreWebInputField(fieldId)
        }

        timePickerDialog.show()
    }
    
    /**
     * Setup scroll and viewport handling for keyboard interactions
     */
    private fun setupScrollAndViewportHandling() {
        // Enable smooth scrolling
        webView.settings.setEnableSmoothTransition(true)
        
        // Enable all scroll types
        webView.isVerticalScrollBarEnabled = true
        webView.isHorizontalScrollBarEnabled = true
        webView.isScrollbarFadingEnabled = true
        
        // Enable nested scrolling
        webView.isNestedScrollingEnabled = true
        
        // Note: Viewport configuration will be injected after page loads
        
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Scroll and viewport handling setup completed")
        }
    }
    
    /**
     * Inject viewport and scroll configuration for proper mobile scaling
     */
    private fun injectViewportAndScrollConfiguration() {
        val viewportScript = """
            (function() {
                // Remove any existing viewport meta tag
                const existingViewport = document.querySelector('meta[name="viewport"]');
                if (existingViewport) {
                    existingViewport.remove();
                }
                
                // Add new viewport meta tag
                const meta = document.createElement('meta');
                meta.name = 'viewport';
                meta.content = 'width=device-width, initial-scale=1.0, user-scalable=yes, viewport-fit=cover';
                document.getElementsByTagName('head')[0].appendChild(meta);
                
                // Add CSS for better keyboard handling
                const style = document.createElement('style');
                style.textContent = `
                    body { 
                        min-height: 100vh; 
                        overflow-y: auto; 
                        -webkit-overflow-scrolling: touch;
                    }
                    html, body {
                        margin: 0;
                        padding: 0;
                    }
                    .keyboard-spacer {
                        height: env(keyboard-inset-height, 0px);
                    }
                `;
                document.head.appendChild(style);
                
                console.log('WebView viewport and scroll configuration injected');
            })();
        """
        
        webView.evaluateJavascript(viewportScript, null)
    }
    
    /**
     * Called by MainActivity when keyboard visibility changes
     */
    fun onKeyboardVisibilityChanged(visible: Boolean, height: Int) {
        isKeyboardVisible = visible
        keyboardHeight = height
        
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Keyboard visibility changed in WebView: visible=$visible, height=$height")
        }
        
        // Handle scroll adjustments
        if (visible) {
            handleKeyboardShown()
        } else {
            handleKeyboardHidden()
        }
    }
    
    /**
     * Handle actions when keyboard is shown
     */
    private fun handleKeyboardShown() {
        // Scroll focused input into view
        focusedInputId?.let { fieldId ->
            scrollToInput(fieldId)
        }
        
        // Inject CSS for keyboard space
        injectKeyboardSpacingCSS(keyboardHeight)
    }
    
    /**
     * Handle actions when keyboard is hidden
     */
    private fun handleKeyboardHidden() {
        // Remove keyboard spacing CSS
        removeKeyboardSpacingCSS()
        
        // Clear focused input reference
        focusedInputId = null
    }
    
    /**
     * Scroll to keep focused input visible
     */
    private fun scrollToInput(fieldId: String) {
        val scrollScript = """
            (function() {
                const field = document.getElementById('$fieldId');
                if (field) {
                    // Calculate the position to scroll to
                    const rect = field.getBoundingClientRect();
                    const viewportHeight = window.innerHeight;
                    const keyboardHeight = $keyboardHeight;
                    const availableHeight = viewportHeight - (keyboardHeight / window.devicePixelRatio);
                    
                    // Check if field is hidden by keyboard
                    if (rect.bottom > availableHeight) {
                        // Scroll to center the field in available space
                        const targetY = rect.top + window.scrollY - (availableHeight / 2) + (rect.height / 2);
                        
                        window.scrollTo({
                            top: Math.max(0, targetY),
                            behavior: 'smooth'
                        });
                    }
                }
            })();
        """
        
        webView.evaluateJavascript(scrollScript, null)
    }
    
    /**
     * Inject CSS to add spacing for keyboard
     */
    private fun injectKeyboardSpacingCSS(keyboardHeight: Int) {
        val keyboardHeightPx = keyboardHeight / context.resources.displayMetrics.density
        
        val cssScript = """
            (function() {
                // Remove existing keyboard spacer
                const existingSpacer = document.getElementById('keyboard-spacer-style');
                if (existingSpacer) {
                    existingSpacer.remove();
                }
                
                // Add new keyboard spacer CSS
                const style = document.createElement('style');
                style.id = 'keyboard-spacer-style';
                style.textContent = `
                    body {
                        padding-bottom: ${keyboardHeightPx}px !important;
                        transition: padding-bottom 0.3s ease;
                    }
                `;
                document.head.appendChild(style);
            })();
        """
        
        webView.evaluateJavascript(cssScript, null)
    }
    
    /**
     * Remove keyboard spacing CSS
     */
    private fun removeKeyboardSpacingCSS() {
        val cssScript = """
            (function() {
                const spacer = document.getElementById('keyboard-spacer-style');
                if (spacer) {
                    spacer.remove();
                }
                
                // Reset body padding
                document.body.style.paddingBottom = '';
            })();
        """
        
        webView.evaluateJavascript(cssScript, null)
    }
    
    /**
     * Enhanced native input handling with focus tracking
     */
    private fun handleNativeInputRequestWithFocus(inputDataJson: String) {
        try {
            val inputData = org.json.JSONObject(inputDataJson)
            val fieldId = inputData.getString("id")
            val inputType = inputData.optString("type", "text")
            
            // Store focused input ID for scroll management
            focusedInputId = fieldId
            
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Native input requested for field: $fieldId, type: $inputType")
            }
            
            // Hide the web input field
            hideWebInputField(fieldId)
            
            // Show native input based on type
            when (inputType.lowercase()) {
                "date" -> showNativeDatePicker(inputData)
                "time" -> showNativeTimePicker(inputData)
                else -> showNativeTextInput(inputData)
            }
            
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) {
                Log.e(TAG, "Error handling native input request", e)
            }
        }
    }
    
    /**
     * Enhanced input field update with scroll management
     */
    private fun updateWebInputFieldWithFocus(fieldId: String, value: String) {
        val js = """
            (function() {
                const field = document.getElementById('$fieldId');
                if (field) {
                    field.value = '$value';
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                    field.style.opacity = '';
                    field.style.pointerEvents = '';
                    
                    // Trigger form validation
                    if (field.form && field.form.checkValidity) {
                        field.form.checkValidity();
                    }
                }
            })();
        """
        webView.evaluateJavascript(js, null)
        
        // Clear focused input reference
        focusedInputId = null
    }
}