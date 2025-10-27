package io.yourname.androidproject

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.*
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebResourceRequestCompat
import android.widget.ProgressBar
import androidx.webkit.WebViewAssetLoader
import io.yourname.androidproject.WebCacheManager
import io.yourname.androidproject.isUrlAllowed
import io.yourname.androidproject.isExternalDomain
import io.yourname.androidproject.matchesCachePattern
import io.yourname.androidproject.utils.CameraUtils
import kotlinx.coroutines.*
import java.io.FileNotFoundException
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
    private val metricsMonitor = MetricsMonitor.getInstance(context)
    private var buildType: String = "debug"  // Default to debug
    private var cachePatterns: List<String> = emptyList()
    private var isHardwareAccelerationEnabled = false
    private var apiBaseUrl: String = ""
    private var isInitialApiCalled: Boolean = false  // Flag to track initial page load
    private var isInitialPageLoaded: Boolean = false
    private var buildOptimisation: Boolean = false // Added property for build optimization
    private lateinit var assetLoader: WebViewAssetLoader
    private var allowedUrls: List<String> = emptyList()

    // Counters for asset loading statistics
    private var assetLoadAttempts = 0
    private var assetLoadFailures = 0

    // Track ongoing cache fetches to prevent duplicates
    private val ongoingCacheFetches = mutableSetOf<String>()

    init {
        setupFromProperties()
        cacheManager = WebCacheManager(context, properties)
        setupWebView()
    }

    private fun setupFromProperties() {
        buildType = properties.getProperty("buildType", "debug")
        apiBaseUrl = properties.getProperty("apiBaseUrl", "")
        // Try to get cache patterns from multiple possible property keys
        val cachePatternProperty = properties.getProperty("cachePattern", "") 
            .takeIf { it.isNotEmpty() } 
            ?: properties.getProperty("android.cachePattern", "")
        
        cachePatterns = cachePatternProperty
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📦 Cache patterns loaded: $cachePatterns (count: ${cachePatterns.size})")
            Log.d(TAG, "📦 Raw cachePattern property: '${properties.getProperty("cachePattern", "")}'")
            Log.d(TAG, "📦 Raw android.cachePattern property: '${properties.getProperty("android.cachePattern", "")}'")
            Log.d(TAG, "📦 Selected cache pattern property: '$cachePatternProperty'")
        }

        // Parse buildOptimisation property
        buildOptimisation = properties.getProperty("buildOptimisation", "false").toBoolean()

        // Load allowed URLs from properties
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

    fun addJavascriptInterface(obj: Any, name: String) {
        // Minimum API level check - JavascriptInterface annotation is safe from API 17+
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.JELLY_BEAN_MR1) {
            Log.e(TAG, "❌ JavaScript interfaces are not secure on API level < 17. Refusing to add interface: $name")
            return
        }

        // Security: Verify that the object has at least one method annotated with @JavascriptInterface
        // Check both declared methods and inherited methods, excluding Object class methods
        val allMethods = obj.javaClass.methods.filter {
            it.declaringClass != Object::class.java
        }
        val hasAnnotatedMethods = allMethods.any {
            it.isAnnotationPresent(android.webkit.JavascriptInterface::class.java)
        }

        if (!hasAnnotatedMethods) {
            Log.e(TAG, "❌ Security: No methods in ${obj.javaClass.simpleName} are annotated with @JavascriptInterface. Refusing to add interface.")
            return
        }

        // Additional security check: only allow whitelisted interface names
        val allowedInterfaces = setOf("NativeBridge", "AndroidBridge")
        if (name !in allowedInterfaces) {
            Log.e(TAG, "❌ Security: Interface name '$name' is not in whitelist. Refusing to add interface.")
            return
        }

        @Suppress("JavascriptInterface")
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
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "🔍 CACHE_CHECK: Checking if URL should be cached: $url")
            Log.d(TAG, "🔍 CACHE_CHECK: Cache patterns: $cachePatterns")
        }

        val shouldCache = matchesCachePattern(url, cachePatterns)

        if (BuildConfig.DEBUG) {
            if (shouldCache) {
                Log.d(TAG, "✅ CACHE_CHECK: URL WILL be cached: $url")
            } else {
                Log.d(TAG, "❌ CACHE_CHECK: URL will NOT be cached (no pattern match): $url")
            }
        }

        return shouldCache
    }

    /**
     * Handle special URL schemes (tel:, mailto:, sms:)
     */
    private fun handleSpecialScheme(url: String): Boolean {
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase() ?: return false

        // Only handle tel, mailto, sms
        if (scheme !in listOf("tel", "mailto", "sms")) {
            return false
        }

        try {
            val intent = when (scheme) {
                "tel" -> Intent(Intent.ACTION_DIAL, uri)
                "mailto" -> Intent(Intent.ACTION_SENDTO, uri)
                "sms" -> Intent(Intent.ACTION_VIEW, uri)
                else -> return false
            }

            // For mailto, check if any apps can handle it before showing chooser
            if (scheme == "mailto") {
                val packageManager = context.packageManager
                val activities = packageManager.queryIntentActivities(intent, 0)
                
                if (activities.isNotEmpty()) {
                    // Apps available - show chooser
                    val chooser = Intent.createChooser(intent, "Send email")
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(chooser)
                } else {
                    // No email apps - try Gmail app, then browser
                    try {
                        val gmailIntent = Intent(Intent.ACTION_SENDTO, uri).apply {
                            setPackage("com.google.android.gm")
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        context.startActivity(gmailIntent)
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "Opened Gmail app")
                        }
                    } catch (e: android.content.ActivityNotFoundException) {
                        // Gmail app not available, open in browser
                        openInInAppBrowser("https://mail.google.com")
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "Opened Gmail in browser")
                        }
                    }
                }
            } else {
                context.startActivity(intent)
            }
            return true
        } catch (e: android.content.ActivityNotFoundException) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "No app to handle $scheme")
            }
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error handling $scheme: ${e.message}")
            return true
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

    private fun setupServiceWorker() {
        try {
            val serviceWorkerController = ServiceWorkerControllerCompat.getInstance()
            serviceWorkerController.setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
                    val url = request.url.toString()

                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "🔧 SERVICE_WORKER: Intercepting request: $url")
                        Log.d(TAG, "🔧 SERVICE_WORKER: Method: ${request.method}")
                        Log.d(TAG, "🔧 SERVICE_WORKER: Headers: ${request.requestHeaders}")
                    }

                    // Check if URL is allowed
                    if (!isUrlAllowed(url, allowedUrls)) {
                        if (BuildConfig.DEBUG) {
                            Log.w(TAG, "🙫 SERVICE_WORKER: Request blocked by access control: $url")
                        }
                        return WebResourceResponse("text/plain", "utf-8", null)
                    }

                    // Let API calls go through normally (skip caching)
                    if (isApiCall(url)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "🌐 SERVICE_WORKER: API call detected, skipping cache: $url")
                        }
                        return null
                    }

                    // Check if this should be cached
                    if (request.method == "GET" && shouldCacheUrl(url)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "🎯 SERVICE_WORKER: Using cache system for: $url")
                        }

                        return try {
                            // Use synchronous cache check to avoid blocking UI thread
                            val headers = request.requestHeaders.toMutableMap().apply {
                                if (!containsKey("Cache-Control")) {
                                    put("Cache-Control", "max-age=86400")
                                }
                            }

                            // Get cached response synchronously (non-blocking for ServiceWorker)
                            val response = cacheManager.getCachedResponseSync(url, headers)
                            if (response != null) {
                                if (BuildConfig.DEBUG) {
                                    Log.d(TAG, "✅ SERVICE_WORKER: Served from cache: $url")
                                }
                                response
                            } else {
                                if (BuildConfig.DEBUG) {
                                    Log.d(TAG, "❌ SERVICE_WORKER: Cache miss: $url")
                                }

                                // Trigger async cache population for next request (with deduplication)
                                val shouldFetch = synchronized(ongoingCacheFetches) {
                                    ongoingCacheFetches.add(url)
                                }

                                if (shouldFetch) {
                                    if (BuildConfig.DEBUG) {
                                        Log.d(TAG, "🔄 SERVICE_WORKER: Triggering async cache fetch for: $url")
                                    }
                                    launch(Dispatchers.IO) {
                                        try {
                                            cacheManager.getCachedResponse(url, headers)
                                            if (BuildConfig.DEBUG) {
                                                Log.d(TAG, "✅ SERVICE_WORKER: Async cache fetch completed: $url")
                                            }
                                        } catch (e: Exception) {
                                            if (BuildConfig.DEBUG) {
                                                Log.e(TAG, "❌ SERVICE_WORKER: Async cache fetch failed: $url - ${e.message}")
                                            }
                                        } finally {
                                            synchronized(ongoingCacheFetches) {
                                                ongoingCacheFetches.remove(url)
                                            }
                                        }
                                    }
                                } else {
                                    if (BuildConfig.DEBUG) {
                                        Log.d(TAG, "⏭️ SERVICE_WORKER: Cache fetch already in progress for: $url")
                                    }
                                }

                                // Let this request fall back to network
                                null
                            }
                        } catch (e: Exception) {
                            if (BuildConfig.DEBUG) {
                                Log.e(TAG, "❌ SERVICE_WORKER: Error processing cache request: ${e.message}")
                            }
                            null
                        }
                    } else {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "⏭️ SERVICE_WORKER: Skipping cache for: $url")
                            Log.d(TAG, "⏭️ SERVICE_WORKER: Method: ${request.method}, shouldCache: ${shouldCacheUrl(url)}")
                        }
                    }

                    return null // Let default handling proceed
                }
            })

            if (BuildConfig.DEBUG) {
                Log.d(TAG, "✅ ServiceWorker intercept configured successfully")
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to setup ServiceWorker: ${e.message}")
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

        // Setup ServiceWorker to intercept requests that bypass normal WebView intercept
        setupServiceWorker()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                request?.url?.let { url ->
                    val urlString = url.toString()

                    // Handle special URL schemes (tel:, mailto:, sms:) HERE to prevent page loading
                    if (handleSpecialScheme(urlString)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "📞 Special scheme handled in shouldOverrideUrlLoading: $urlString")
                        }
                        return true // Prevent WebView from trying to load the URL
                    }

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

                // Track all network requests
                metricsMonitor.recordNetworkRequest(url)

                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "🔄 INTERCEPT: URL: $url")
                    Log.d(TAG, "🔄 INTERCEPT: Method: ${request.method}")
                    Log.d(TAG, "🔄 INTERCEPT: Thread: ${Thread.currentThread().name}")
                    Log.d(TAG, "🔄 INTERCEPT: File extension: ${url.substringAfterLast('.', "none")}")
                    Log.d(TAG, "🔄 INTERCEPT: isInitialPageLoaded: $isInitialPageLoaded")
                }

                if (!isUrlAllowed(url, allowedUrls)) {
                    if (BuildConfig.DEBUG) {
                        Log.w(TAG, "🚫 STEP_1_FAIL: Network request blocked by access control: $url")
                        Log.w(TAG, "🚫 STEP_1_FAIL: Allowed URLs: $allowedUrls")
                    }
                    // Return an empty response to block the request
                    return WebResourceResponse("text/plain", "utf-8", null)
                } else {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "✅ STEP_1_PASS: URL allowed by access control: $url")
                    }
                }

                // Handle the initial route request - intercept first request regardless of host
                if (!isInitialApiCalled && request.method == "GET") {
                    isInitialApiCalled = true
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "📄 STEP_2_INITIAL: Serving initial index.html from assets for route: $url")
                        Log.d(TAG, "📄 STEP_2_INITIAL: This request will NOT go through cache system")
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

                // Let API calls go through normally (before any other checks)
                if (isApiCall(url)) {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "🌐 STEP_3_API: API call detected, letting it go through network: $url")
                        Log.d(TAG, "🌐 STEP_3_API: This request will NOT go through cache or asset system")
                    }
                    return null
                }

                if(!isInitialPageLoaded) {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "🔍 STEP_4_CHECK: Initial page not loaded yet, checking for static resources")
                        Log.d(TAG, "🔍 STEP_4_CHECK: isStaticResourceRequest($url) = ${isStaticResourceRequest(url)}")
                        Log.d(TAG, "🔍 STEP_4_CHECK: shouldCacheUrl($url) = ${shouldCacheUrl(url)}")
                    }

                    // IMPORTANT: Skip asset loading if the URL matches a cache pattern
                    // This allows cached resources to be served from the cache system instead
                    if (request.method == "GET" && isStaticResourceRequest(url) && !shouldCacheUrl(url)) {
                        val assetPath = extractAssetPath(url)
                        assetLoadAttempts++

                        try {
                            val mimeType = getMimeType(assetPath)
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "📦 Attempting to serve from assets: $assetPath (not in cache patterns)")
                            }
                            val inputStream = context.assets.open(assetPath)
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "✅ Successfully loaded from assets: $assetPath")
                            }
                            return WebResourceResponse(mimeType, "utf-8", inputStream)
                        } catch (e: FileNotFoundException) {
                            assetLoadFailures++
                            if (BuildConfig.DEBUG) {
                                Log.w(TAG, "📁 Asset not found: $assetPath - falling through to cache check")
                            }
                            // Asset not found - fall through to cache check below
                        } catch (e: SecurityException) {
                            assetLoadFailures++
                            Log.e(TAG, "🚫 Security error loading asset: $assetPath", e)
                            return WebResourceResponse("text/plain", "utf-8", null)
                        } catch (e: OutOfMemoryError) {
                            assetLoadFailures++
                            Log.e(TAG, "📢 Out of memory loading asset: $assetPath", e)
                            // Try to free some memory
                            System.gc()
                            return WebResourceResponse("text/plain", "utf-8", null)
                        } catch (e: Exception) {
                            assetLoadFailures++
                            if (BuildConfig.DEBUG) {
                                Log.e(TAG, "❌ Unexpected error loading asset: $assetPath", e)
                                Log.d(TAG, "⚠️ Falling through to cache check for: $url")
                            }
                            // Unexpected error - fall through to cache check below
                        }
                    } else if (shouldCacheUrl(url)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "⏭️ STEP_4_SKIP: Skipping asset loading for cached URL: $url")
                        }
                    }
                } else {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "✅ STEP_3_PASS: Initial page loaded, skipping asset loading logic")
                    }
                }

                // For non-API HTTP requests that match cache patterns, use cache system
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "🔍 STEP_5_CACHE_CHECK: Evaluating cache conditions")
                    Log.d(TAG, "🔍 STEP_5_CACHE_CHECK: Request method: ${request.method} (need GET)")
                    Log.d(TAG, "🔍 STEP_5_CACHE_CHECK: shouldCacheUrl($url) = ${shouldCacheUrl(url)}")
                }

                if (request.method == "GET" && shouldCacheUrl(url)) {
                    // Track that this request was evaluated for caching
                    metricsMonitor.recordCacheEvaluation(url)
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "🎯 STEP_5_SUCCESS: Using cache system for URL: $url")
                        Log.d(TAG, "🎯 STEP_5_SUCCESS: Request method: ${request.method}")
                        Log.d(TAG, "🎯 STEP_5_SUCCESS: isInitialPageLoaded: $isInitialPageLoaded")
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

                        // Use synchronous cache check to avoid blocking
                        val response = cacheManager.getCachedResponseSync(url, headers)

                        if (response != null) {
                            if (BuildConfig.DEBUG) {
                                val duration = System.currentTimeMillis() - startTime
                                Log.d(TAG, "✅ WEBVIEW_CLIENT: Served from cache in ${duration}ms: $url")
                            }
                            metricsMonitor.recordCacheHit(url)
                            return response
                        } else {
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "❌ WEBVIEW_CLIENT: Cache miss, triggering async fetch: $url")
                            }
                            metricsMonitor.recordCacheMiss(url)

                            // Trigger async cache population for next time
                            val shouldFetch = synchronized(ongoingCacheFetches) {
                                ongoingCacheFetches.add(url)
                            }

                            if (shouldFetch) {
                                launch(Dispatchers.IO) {
                                    try {
                                        cacheManager.getCachedResponse(url, headers)
                                        if (BuildConfig.DEBUG) {
                                            Log.d(TAG, "✅ WEBVIEW_CLIENT: Async cache fetch completed: $url")
                                        }
                                    } catch (e: Exception) {
                                        if (BuildConfig.DEBUG) {
                                            Log.e(TAG, "❌ WEBVIEW_CLIENT: Async cache fetch failed: $url - ${e.message}")
                                        }
                                    } finally {
                                        synchronized(ongoingCacheFetches) {
                                            ongoingCacheFetches.remove(url)
                                        }
                                    }
                                }
                            }

                            // Return null to let network handle this request
                            return null
                        }
                    } catch (e: OutOfMemoryError) {
                        Log.e(TAG, "📢 Out of memory processing cache request: $url", e)
                        metricsMonitor.recordCacheMiss(url)
                        System.gc()
                        return null
                    } catch (e: SecurityException) {
                        Log.e(TAG, "🚫 Security error in cache processing: $url", e)
                        metricsMonitor.recordCacheMiss(url)
                        return null
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ Unexpected error processing cache request: $url: ${e.message}")
                        if (BuildConfig.DEBUG) {
                            e.printStackTrace()
                        }
                        metricsMonitor.recordCacheMiss(url)
                        return null
                    } finally {
                        enableHardwareAcceleration()
                    }
                } else {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "❌ STEP_5_FAIL: URL doesn't match cache criteria, skipping cache")
                        Log.d(TAG, "❌ STEP_5_FAIL: URL: $url")
                        Log.d(TAG, "❌ STEP_5_FAIL: Request method: ${request.method} (need GET)")
                        Log.d(TAG, "❌ STEP_5_FAIL: shouldCacheUrl result: ${shouldCacheUrl(url)}")
                        Log.d(TAG, "❌ STEP_5_FAIL: This request will go through normal network loading")
                    }
                }

                return null
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
                val startTime = System.currentTimeMillis()
                view?.tag = startTime // Store start time for performance tracking
                url?.let { metricsMonitor.trackPageLoadStart(it) }
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "⏳ Page load started for: $url - Hardware Acceleration: $isHardwareAccelerationEnabled")
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progressBar.visibility = View.GONE
                if(!isInitialPageLoaded){
                    isInitialPageLoaded = true
                }
                url?.let { metricsMonitor.trackPageLoadEnd(it) }
                if (BuildConfig.DEBUG) {
                    val startTime = view?.tag as? Long ?: return
                    val loadTime = System.currentTimeMillis() - startTime
                    Log.d(TAG, "✅ Page load finished for: $url - Load time: ${loadTime}ms - Hardware Acceleration: $isHardwareAccelerationEnabled")
                    Log.d(TAG, "📊 Asset loading stats: Attempted: $assetLoadAttempts, Failed: $assetLoadFailures (${String.format("%.1f", assetLoadFailures * 100.0 / assetLoadAttempts.coerceAtLeast(1))}%)")
                    Log.d(TAG, "📊 ${metricsMonitor.getCacheStats()}")

                    // Log files served from cache
                    val cachedFiles = metricsMonitor.getFilesServedFromCache()
                    if (cachedFiles.isNotEmpty()) {
                        Log.d(TAG, "📁 FILES_FROM_CACHE: ${cachedFiles.size} files served from cache on this page:")
                        cachedFiles.takeLast(5).forEach { cachedUrl ->
                            Log.d(TAG, "📁   ✅ ${cachedUrl.substringAfterLast("/")}")
                        }
                    }

                    // Log brief performance summary
                    Log.d(TAG, "📊 PERFORMANCE_SUMMARY: Page finished, showing current metrics")
                    metricsMonitor.logAllMetrics()
                }
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

            override fun onReceivedSslError(view: WebView?, handler: android.webkit.SslErrorHandler?, error: android.net.http.SslError?) {
                if (error != null) {
                    val errorMsg = when (error.primaryError) {
                        android.net.http.SslError.SSL_EXPIRED -> "Certificate expired"
                        android.net.http.SslError.SSL_IDMISMATCH -> "Certificate hostname mismatch"
                        android.net.http.SslError.SSL_NOTYETVALID -> "Certificate not yet valid"
                        android.net.http.SslError.SSL_UNTRUSTED -> "Certificate authority not trusted"
                        android.net.http.SslError.SSL_DATE_INVALID -> "Certificate date invalid"
                        android.net.http.SslError.SSL_INVALID -> "Certificate invalid"
                        else -> "Unknown SSL error"
                    }

                    Log.e(TAG, "🔒 SSL Error for ${error.url}: $errorMsg")

                    // NEVER proceed on SSL errors in production
                    // Only allow in debug mode for development/testing with local certificates
                    if (BuildConfig.DEBUG) {
                        Log.w(TAG, "⚠️ DEBUG MODE: Ignoring SSL error - DO NOT DO THIS IN PRODUCTION!")
                        handler?.proceed()
                    } else {
                        // Cancel the request in production
                        handler?.cancel()

                        // Show error page for main frame SSL errors
                        try {
                            view?.loadUrl("file:///android_asset/build/public/error.html")
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to load SSL error page: ${e.message}")
                        }
                    }
                } else {
                    handler?.cancel()
                }
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

            override fun onPermissionRequest(request: PermissionRequest) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Permission request from web content: ${request.resources?.joinToString()}")
                }

                // Check if camera permission is being requested
                val cameraRequested = request.resources?.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) == true

                if (cameraRequested) {
                    // Check if native app has camera permission
                    if (CameraUtils.hasCameraPermission(context as android.app.Activity)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "Granting camera permission to WebView - native permission available")
                        }
                        request.grant(request.resources)
                    } else {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "Denying camera permission to WebView - native permission not granted")
                        }
                        request.deny()
                    }
                } else {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "Denying non-camera permission request: ${request.resources?.joinToString()}")
                    }
                    request.deny()
                }
            }
        }

        // Only enable WebView debugging in debug builds
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    }
}