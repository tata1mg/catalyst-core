package com.example.androidProject

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import androidx.webkit.WebViewAssetLoader
import com.example.myapplication.WebCacheManager
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

    // Counters for asset loading statistics
    private var assetLoadAttempts = 0
    private var assetLoadFailures = 0

    init {
        cacheManager = WebCacheManager(context)
        setupFromProperties()
        setupWebView()
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

        // Set initial flags based on buildOptimisation
        if (buildOptimisation) {
            isInitialApiCalled = false
            isInitialPageLoaded = false
        } else {
            isInitialApiCalled = false  // Default value
            isInitialPageLoaded = false // Default value
        }

        Log.d(TAG, "Build type: $buildType")
        Log.d(TAG, "Cache Pattern: $cachePatterns")
        Log.d(TAG, "API Base URL: $apiBaseUrl")
        Log.d(TAG, "Build Optimisation: $buildOptimisation")
        Log.d(TAG, "Initial API Called: $isInitialApiCalled")
        Log.d(TAG, "Initial Page Loaded: $isInitialPageLoaded")

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
        Log.d(TAG, "🔗 Added JavaScript interface: $name")
    }

    fun destroy() {
        job.cancel()
        webView.destroy()
    }

    fun cleanupCache() {
        launch(Dispatchers.IO) {
            Log.d(TAG, "📝 Starting cache cleanup on thread: ${Thread.currentThread().name}")
            val startTime = System.currentTimeMillis()
            disableHardwareAcceleration()
            try {
                cacheManager.cleanup()
                val duration = System.currentTimeMillis() - startTime
                Log.d(TAG, "⏱️ Cache cleanup completed in ${duration}ms on thread: ${Thread.currentThread().name}")
            } finally {
                enableHardwareAcceleration()
            }
        }
    }

    fun enableHardwareAcceleration() {
        if (!isHardwareAccelerationEnabled) {
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isHardwareAccelerationEnabled = true
            Log.d(TAG, "🚀 Hardware acceleration enabled - Thread: ${Thread.currentThread().name}")
        }
    }

    fun disableHardwareAcceleration() {
        if (isHardwareAccelerationEnabled) {
            webView.setLayerType(View.LAYER_TYPE_NONE, null)
            isHardwareAccelerationEnabled = false
            Log.d(TAG, "⚫ Hardware acceleration disabled - Thread: ${Thread.currentThread().name}")
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
        Log.d(TAG, "🌐 Setting up WebView on thread: ${Thread.currentThread().name}")

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

            // Allow access to file URLs and JavaScript interfaces
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                request?.url?.let { url ->

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
                Log.d(TAG, "🔄 Intercepting request for: $url on thread: ${Thread.currentThread().name}")

                // Handle the initial route request - intercept first request regardless of host
                if (!isInitialApiCalled && request.method == "GET") {
                    isInitialApiCalled = true
                    Log.d(TAG, "📄 Serving initial index.html from assets for route: $url")

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
                            Log.d(TAG, "📦 Attempting to serve from assets: $assetPath")
                            val inputStream = context.assets.open(assetPath)
                            Log.d(TAG, "✅ Successfully loaded from assets: $assetPath")
                            return WebResourceResponse(mimeType, "utf-8", inputStream)
                        } catch (e: Exception) {
                            assetLoadFailures++
                            Log.e(TAG, "❌ Error loading asset: $assetPath", e)
                            Log.d(TAG, "⚠️ Falling back to network for: $url")
                            // Return null to let the WebView load from network
                            return null
                        }
                    }

                    // Let API calls go through normally
                    if (isApiCall(url)) {
                        Log.d(TAG, "🌐 API call detected, letting it go through network: $url")
                        return null
                    }
                }


                // For non-API HTTP requests that match cache patterns, use cache system
                if (request.method == "GET" && shouldCacheUrl(url)) {
                    return runBlocking {
                        Log.d(TAG, "⚙️ Processing cacheable request in coroutine on thread: ${Thread.currentThread().name}")
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
                                val duration = System.currentTimeMillis() - startTime
                                Log.d(TAG, "✅ Served from cache in ${duration}ms: $url")
                                response
                            } else {
                                Log.d(TAG, "❌ Cache miss for: $url")
                                null
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "❌ Error processing request for URL: $url", e)
                            e.printStackTrace()
                            null
                        } finally {
                            enableHardwareAcceleration()
                        }
                    }
                } else {
                    Log.d(TAG, "⏭️ URL doesn't match cache criteria, skipping cache: $url")
                }

                return null
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
                val startTime = System.currentTimeMillis()
                view?.tag = startTime // Store start time for performance tracking
                Log.d(TAG, "⏳ Page load started for: $url - Hardware Acceleration: $isHardwareAccelerationEnabled")
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progressBar.visibility = View.GONE
                if(!isInitialPageLoaded){
                    isInitialPageLoaded = true
                }
                val startTime = view?.tag as? Long ?: return
                val loadTime = System.currentTimeMillis() - startTime
                Log.d(TAG, "✅ Page load finished for: $url - Load time: ${loadTime}ms - Hardware Acceleration: $isHardwareAccelerationEnabled")
                Log.d(TAG, "📊 Asset loading stats: Attempted: $assetLoadAttempts, Failed: $assetLoadFailures (${String.format("%.1f", assetLoadFailures * 100.0 / assetLoadAttempts.coerceAtLeast(1))}%)")
                super.onPageFinished(view, url)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                error?.let {
                    Log.e(TAG, "❌ Error loading ${request?.url}: ${it.errorCode} ${it.description}")
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
                Log.d(TAG, "Console: ${consoleMessage?.message()} -- From line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                return true
            }
        }

        WebView.setWebContentsDebuggingEnabled(true)
    }
}