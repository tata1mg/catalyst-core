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
import io.yourname.androidproject.URLWhitelistManager
import io.yourname.androidproject.matchesCachePattern
import io.yourname.androidproject.utils.CameraUtils
import io.yourname.androidproject.utils.NetworkUtils
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
    private val FLOW_TAG = "CatalystOfflineFlow"
    private val job = SupervisorJob()
    override val coroutineContext = Dispatchers.Main + job

    private var cacheManager: WebCacheManager
    private var offlineCacheService: OfflineCacheService
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
    private var accessControlEnabled: Boolean = false
    private val offlineAssetPath = "offline/offline.html"
    private val offlineAssetUrl = "file:///android_asset/$offlineAssetPath"
    private var offlinePageVisible = false
    private var lastTargetUrl: String? = null
    private var activeOfflineRouteOrigin: String? = null
    private var visibleOfflineSnapshotUrl: String? = null
    private var defaultRequestHeaders: Map<String, String> = emptyMap()
    var onPageStarted: (() -> Unit)? = null

    // Counters for asset loading statistics
    private var assetLoadAttempts = 0
    private var assetLoadFailures = 0

    init {
        setupFromProperties()
        cacheManager = WebCacheManager(context, properties)
        offlineCacheService = OfflineCacheService(context)
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

        // Access control toggle
        accessControlEnabled = properties
            .getProperty("accessControl.enabled", "true")
            .equals("true", ignoreCase = true)

        // Initialize URLWhitelistManager with access control configuration
        URLWhitelistManager.initialize(accessControlEnabled, allowedUrls)

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

    fun setDefaultRequestHeaders(headers: Map<String, String>) {
        defaultRequestHeaders = headers.toMap()
    }

    private fun loadUrlInternal(url: String) {
        val isNetworkUrl = url.startsWith("http://") || url.startsWith("https://")
        val isOnline = NetworkUtils.getCurrentStatus(context).isOnline

        if (BuildConfig.DEBUG) {
            Log.d(FLOW_TAG, "WEBVIEW load-url start online=$isOnline url=$url headers=${defaultRequestHeaders.keys.sorted()}")
        }

        if (isNetworkUrl && isOnline) {
            offlineCacheService.refreshManifestAsync(url, defaultRequestHeaders)
        }

        if (isNetworkUrl && defaultRequestHeaders.isNotEmpty()) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "🌐 Loading with headers: $url, headers=$defaultRequestHeaders")
            }
            webView.loadUrl(url, defaultRequestHeaders)
        } else {
            webView.loadUrl(url)
        }
        if (BuildConfig.DEBUG) {
            Log.d(FLOW_TAG, "WEBVIEW load-url dispatched url=$url")
        }
    }

    fun loadUrl(url: String) {
        lastTargetUrl = url
        offlinePageVisible = false
        visibleOfflineSnapshotUrl = null
        activeOfflineRouteOrigin = null
        loadUrlInternal(url)
    }

    fun updateLastTargetUrl(url: String) {
        lastTargetUrl = url
    }

    fun showOfflinePage() {
        if (offlinePageVisible) {
            return
        }

        // Verify offline asset exists to avoid crash
        try {
            context.assets.open(offlineAssetPath).close()
            offlinePageVisible = true
            visibleOfflineSnapshotUrl = null
            activeOfflineRouteOrigin = null
            loadUrlInternal(offlineAssetUrl)
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "📴 Showing offline page from assets: $offlineAssetPath")
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ offline.html not found in assets, cannot show offline page", e)
        }
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

    fun clearAllCache() {
        cacheManager.clearAll()
        offlineCacheService.clearAll()
        activeOfflineRouteOrigin = null
        visibleOfflineSnapshotUrl = null
    }

    fun showOfflineRouteOrOfflinePage(url: String) {
        val snapshotUrl = normalizeUrlWithoutFragment(url)
        if (visibleOfflineSnapshotUrl == snapshotUrl) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "📴 Cached offline route snapshot already visible: $url")
            }
            return
        }

        if (offlineCacheService.hasRouteSnapshot(url)) {
            offlinePageVisible = false
            visibleOfflineSnapshotUrl = snapshotUrl
            updateActiveOfflineRoute(url, true)
            loadUrlInternal(url)
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "📴 Loading cached offline route through request interceptor: $url")
            }
            return
        }

        showOfflinePage()
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
        val allowedInterfaces = setOf("NativeBridge", "AndroidBridge", "PluginBridge")
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

    fun removeJavascriptInterface(name: String) {
        try {
            webView.removeJavascriptInterface(name)
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "🔌 Removed JavaScript interface: $name")
            }
        } catch (e: Exception) {
            Log.w(TAG, "⚠️ Failed to remove JavaScript interface '$name': ${e.message}")
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

    private fun shouldCacheRequest(request: WebResourceRequest, url: String): Boolean {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "🔍 CACHE_CHECK: Checking if URL should be cached: $url")
            Log.d(TAG, "🔍 CACHE_CHECK: Cache patterns: $cachePatterns")
        }

        val matchesPattern = matchesCachePattern(url, cachePatterns)
        val offlineRouteSubresource = shouldCacheOfflineRouteSubresource(request, url)
        val shouldCache = matchesPattern || offlineRouteSubresource

        if (BuildConfig.DEBUG) {
            if (shouldCache) {
                Log.d(TAG, "✅ CACHE_CHECK: URL WILL be cached: $url (pattern=$matchesPattern, offlineRouteSubresource=$offlineRouteSubresource)")
                Log.d(FLOW_TAG, "CACHE eligible=true pattern=$matchesPattern offlineRouteSubresource=$offlineRouteSubresource mainFrame=${request.isForMainFrame} method=${request.method} dest=${requestHeader(request, "Sec-Fetch-Dest") ?: "none"} accept=${requestHeader(request, "Accept") ?: "none"} activeOrigin=${activeOfflineRouteOrigin ?: "none"} url=$url")
            } else {
                Log.d(TAG, "❌ CACHE_CHECK: URL will NOT be cached (no pattern match): $url")
                Log.d(FLOW_TAG, "CACHE eligible=false pattern=$matchesPattern offlineRouteSubresource=$offlineRouteSubresource mainFrame=${request.isForMainFrame} method=${request.method} dest=${requestHeader(request, "Sec-Fetch-Dest") ?: "none"} accept=${requestHeader(request, "Accept") ?: "none"} activeOrigin=${activeOfflineRouteOrigin ?: "none"} url=$url")
            }
        }

        return shouldCache
    }

    private fun shouldCacheOfflineRouteSubresource(request: WebResourceRequest, url: String): Boolean {
        if (request.isForMainFrame || request.method != "GET") return false
        if (!isHttpUrl(url) || isApiCall(url) || isInternalOfflineRuntimeUrl(url)) return false

        val activeOrigin = activeOfflineRouteOrigin ?: return false
        if (originForUrl(url) != activeOrigin) return false

        val destination = requestHeader(request, "Sec-Fetch-Dest")?.lowercase()
        if (destination == "document" || destination == "empty") return false
        if (destination in setOf("script", "style", "image", "font", "audio", "video", "track", "manifest")) {
            return true
        }

        val accept = requestHeader(request, "Accept")?.lowercase().orEmpty()
        if (accept.contains("text/html") ||
            accept.contains("application/json") ||
            accept.contains("text/event-stream")
        ) {
            return false
        }
        if (accept.contains("text/css") ||
            accept.contains("javascript") ||
            accept.contains("image/") ||
            accept.contains("font/") ||
            accept.contains("application/font") ||
            accept.contains("application/wasm")
        ) {
            return true
        }

        return offlineCacheService.shouldCacheAssetUrl(url)
    }

    private fun requestHeader(request: WebResourceRequest, name: String): String? {
        return request.requestHeaders.entries.firstOrNull {
            it.key.equals(name, ignoreCase = true)
        }?.value
    }

    private fun updateActiveOfflineRoute(url: String, active: Boolean) {
        activeOfflineRouteOrigin = if (active) originForUrl(url) else null
        if (BuildConfig.DEBUG) {
            Log.d(FLOW_TAG, "ROUTE active=$active activeOrigin=${activeOfflineRouteOrigin ?: "none"} url=$url")
        }
    }

    private fun isVisibleOfflineSnapshot(url: String?): Boolean {
        if (url == null) return false
        return visibleOfflineSnapshotUrl == normalizeUrlWithoutFragment(url)
    }

    private fun normalizeUrlWithoutFragment(url: String): String {
        return try {
            Uri.parse(url).buildUpon().fragment(null).build().toString()
        } catch (_: Exception) {
            url
        }
    }

    private fun originForUrl(url: String): String? {
        return try {
            val uri = Uri.parse(url)
            val scheme = uri.scheme?.lowercase() ?: return null
            val authority = uri.authority ?: return null
            if (scheme != "http" && scheme != "https") return null
            "$scheme://$authority"
        } catch (_: Exception) {
            null
        }
    }

    private fun isHttpUrl(url: String): Boolean {
        val scheme = Uri.parse(url).scheme?.lowercase()
        return scheme == "http" || scheme == "https"
    }

    private fun isInternalOfflineRuntimeUrl(url: String): Boolean {
        val path = Uri.parse(url).path ?: return false
        return path == "/catalyst-offline-manifest.json" ||
            path == "/catalyst-sw.js" ||
            path == "/offline.html"
    }

    /**
     * Handle special URL schemes (tel:, mailto:, sms:)
     */
    private fun handleSpecialScheme(url: String): Boolean {
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase() ?: return false

        // Handle offline retry scheme
        if (scheme == "catalyst" && (uri.host?.lowercase() == "retry" || uri.schemeSpecificPart?.lowercase() == "retry")) {
            val status = NetworkUtils.getCurrentStatus(context)
            if (status.isOnline) {
                val target = lastTargetUrl
                if (target != null) {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "🔄 Retry requested, online. Reloading: $target")
                    }
                    offlinePageVisible = false
                    lastTargetUrl = target
                    loadUrlInternal(target)
                } else if (BuildConfig.DEBUG) {
                    Log.w(TAG, "🔄 Retry requested but no target URL is known")
                }
            } else if (BuildConfig.DEBUG) {
                Log.d(TAG, "🔄 Retry requested but still offline; staying on offline page")
            }
            return true
        }

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

        // TODO: Add HTML file workflow - index.html not available yet
        // If path is empty or just "/", return index.html
        // if (cleanPath.isEmpty()) {
        //     return "build/public/index.html"
        // }

        // Special case for favicon.ico which might be in root
        if (cleanPath == "favicon.ico") {
            return "build/public/favicon.ico"
        }

        // Extract just the filename portion, ignoring any directory structure
        val fileName = cleanPath.substringAfterLast("/")

        // Always look directly in build/public for the file, regardless of the URL path
        return "build/public/$fileName"
    }

    private fun withCorsHeaders(response: WebResourceResponse): WebResourceResponse {
        val responseHeaders = response.responseHeaders
        if (responseHeaders.isNullOrEmpty()) {
            response.responseHeaders = mutableMapOf(
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, OPTIONS",
                "Access-Control-Allow-Headers" to "*"
            )
        }
        return response
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
                    val isOnline = NetworkUtils.getCurrentStatus(context).isOnline

                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "🔧 SERVICE_WORKER: Intercepting request: $url")
                        Log.d(TAG, "🔧 SERVICE_WORKER: Method: ${request.method}")
                        Log.d(TAG, "🔧 SERVICE_WORKER: Headers: ${request.requestHeaders}")
                        Log.d(FLOW_TAG, "SW intercept method=${request.method} online=$isOnline mainFrame=${request.isForMainFrame} url=$url")
                    }

                    // Check if URL is allowed
                    if (!URLWhitelistManager.isUrlAllowed(url)) {
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
                    if (request.method == "GET" && shouldCacheRequest(request, url)) {
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
                            val response = if (NetworkUtils.getCurrentStatus(context).isOnline) {
                                cacheManager.getCachedResponseOrFetchSync(url, headers)
                            } else {
                                cacheManager.getCachedResponseSync(url, headers)
                            }
                            if (response != null) {
                                if (BuildConfig.DEBUG) {
                                    Log.d(TAG, "✅ SERVICE_WORKER: Served from cache: $url")
                                    Log.d(FLOW_TAG, "SW response source=cache-or-fetch mime=${response.mimeType ?: "unknown"} encoding=${response.encoding ?: "unknown"} url=$url")
                                }
                                withCorsHeaders(response)
                            } else {
                                if (BuildConfig.DEBUG) {
                                    Log.d(TAG, "❌ SERVICE_WORKER: Cache miss: $url")
                                    Log.d(FLOW_TAG, "SW response source=network-fallback reason=cache-null url=$url")
                                }
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
                            Log.d(TAG, "⏭️ SERVICE_WORKER: Method: ${request.method}, shouldCache: ${shouldCacheRequest(request, url)}")
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

            cacheMode = WebSettings.LOAD_DEFAULT
            databaseEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false

            // TODO: Enable these when build optimization feature is implemented
            // These are deprecated but may be needed for local file access in development
            // allowFileAccessFromFileURLs = BuildConfig.DEBUG
            // allowUniversalAccessFromFileURLs = BuildConfig.DEBUG
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
                    if (url.scheme in listOf("http", "https") && URLWhitelistManager.isExternalDomain(urlString)) {
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "🌍 External domain detected, opening in in-app browser: $urlString")
                        }
                        openInInAppBrowser(urlString)
                        return true
                    }

                    // Check if URL is allowed for internal navigation
                    if (!URLWhitelistManager.isUrlAllowed(urlString)) {
                        if (BuildConfig.DEBUG) {
                            Log.w(TAG, "🚫 URL blocked by access control: $urlString")
                        }
                        return true
                    }

                    // Let WebView handle loading non-API HTTP/HTTPS URLs
                    if (url.scheme in listOf("http", "https")) {
                        lastTargetUrl = urlString
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
                val isOnline = NetworkUtils.getCurrentStatus(context).isOnline

                // Track all network requests
                metricsMonitor.recordNetworkRequest(url)

                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "🔄 INTERCEPT: URL: $url")
                    Log.d(TAG, "🔄 INTERCEPT: Method: ${request.method}")
                    Log.d(TAG, "🔄 INTERCEPT: Thread: ${Thread.currentThread().name}")
                    Log.d(TAG, "🔄 INTERCEPT: File extension: ${url.substringAfterLast('.', "none")}")
                    Log.d(TAG, "🔄 INTERCEPT: isInitialPageLoaded: $isInitialPageLoaded")
                    Log.d(FLOW_TAG, "WV intercept method=${request.method} online=$isOnline mainFrame=${request.isForMainFrame} initialLoaded=$isInitialPageLoaded dest=${requestHeader(request, "Sec-Fetch-Dest") ?: "none"} accept=${requestHeader(request, "Accept") ?: "none"} url=$url")
                }

                if (!URLWhitelistManager.isUrlAllowed(url)) {
                    if (BuildConfig.DEBUG) {
                        Log.w(TAG, "🚫 STEP_1_FAIL: Network request blocked by access control: $url")
                    }
                    // Return an empty response to block the request
                    return WebResourceResponse("text/plain", "utf-8", null)
                } else if (BuildConfig.DEBUG) {
                    if (URLWhitelistManager.isAccessControlEnabled()) {
                        Log.d(TAG, "✅ STEP_1_PASS: URL allowed by access control: $url")
                    } else {
                        Log.d(TAG, "⚙️ STEP_1_SKIP: Access control disabled, allowing URL: $url")
                    }
                }

                val isMainFrameDocument = request.isForMainFrame &&
                    request.method == "GET" &&
                    (request.url.scheme == "http" || request.url.scheme == "https") &&
                    !isApiCall(url)

                if (isMainFrameDocument) {
                    val headers = defaultRequestHeaders.toMutableMap().apply {
                        putAll(request.requestHeaders)
                    }
                    if (BuildConfig.DEBUG) {
                        Log.d(FLOW_TAG, "DOCUMENT intercept online=$isOnline url=$url headers=${headers.keys.sorted()}")
                    }

                    if (isOnline) {
                        offlineCacheService.refreshManifestIfMissing(url, headers)
                        val isOfflineRoute = offlineCacheService.isOfflineRouteUrl(url)
                        updateActiveOfflineRoute(url, isOfflineRoute)
                        visibleOfflineSnapshotUrl = null
                        if (BuildConfig.DEBUG) {
                            Log.d(FLOW_TAG, "DOCUMENT online routeEligible=$isOfflineRoute action=allow-network-and-background-snapshot url=$url")
                        }
                        offlineCacheService.storeRouteSnapshotAsync(url, headers)
                    } else {
                        val snapshotResponse = offlineCacheService.getRouteSnapshotResponse(url)
                        if (snapshotResponse != null) {
                            updateActiveOfflineRoute(url, true)
                            visibleOfflineSnapshotUrl = normalizeUrlWithoutFragment(url)
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "📴 INTERCEPT: Serving offline route snapshot: $url")
                                Log.d(FLOW_TAG, "DOCUMENT offline response=route-snapshot mime=${snapshotResponse.mimeType ?: "unknown"} url=$url")
                            }
                            return withCorsHeaders(snapshotResponse)
                        }
                        updateActiveOfflineRoute(url, false)
                        if (BuildConfig.DEBUG) {
                            Log.d(FLOW_TAG, "DOCUMENT offline response=network-fallback reason=snapshot-miss url=$url")
                        }
                    }
                } else if (request.isForMainFrame &&
                    request.method == "GET" &&
                    (request.url.scheme == "http" || request.url.scheme == "https")
                ) {
                    updateActiveOfflineRoute(url, false)
                }

                // TODO: Add HTML file workflow - index.html not available yet
                // Handle the initial route request - intercept first request regardless of host
                // if (!isInitialApiCalled && request.method == "GET") {
                //     isInitialApiCalled = true
                //     if (BuildConfig.DEBUG) {
                //         Log.d(TAG, "📄 STEP_2_INITIAL: Serving initial index.html from assets for route: $url")
                //         Log.d(TAG, "📄 STEP_2_INITIAL: This request will NOT go through cache system")
                //     }
                //
                //     try {
                //         val indexHtml = context.assets.open("build/public/index.html")
                //         return WebResourceResponse(
                //             "text/html",
                //             "utf-8",
                //             indexHtml
                //         )
                //     } catch (e: Exception) {
                //         Log.e(TAG, "❌ Error loading index.html from assets", e)
                //     }
                // }

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
                        Log.d(TAG, "🔍 STEP_4_CHECK: shouldCacheRequest($url) = ${shouldCacheRequest(request, url)}")
                    }

                    // IMPORTANT: Skip asset loading if the URL matches a cache pattern
                    // This allows cached resources to be served from the cache system instead
                    if (request.method == "GET" && isStaticResourceRequest(url) && !shouldCacheRequest(request, url)) {
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
                    } else if (shouldCacheRequest(request, url)) {
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
                    Log.d(TAG, "🔍 STEP_5_CACHE_CHECK: shouldCacheRequest($url) = ${shouldCacheRequest(request, url)}")
                }

                if (request.method == "GET" && shouldCacheRequest(request, url)) {
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
                        val response = if (NetworkUtils.getCurrentStatus(context).isOnline) {
                            cacheManager.getCachedResponseOrFetchSync(url, headers)
                        } else {
                            cacheManager.getCachedResponseSync(url, headers)
                        }

                        if (response != null) {
                            if (BuildConfig.DEBUG) {
                                val duration = System.currentTimeMillis() - startTime
                                Log.d(TAG, "✅ WEBVIEW_CLIENT: Served from cache in ${duration}ms: $url")
                                Log.d(FLOW_TAG, "ASSET response source=cache-or-fetch online=${NetworkUtils.getCurrentStatus(context).isOnline} durationMs=$duration mime=${response.mimeType ?: "unknown"} encoding=${response.encoding ?: "unknown"} url=$url")
                            }
                            metricsMonitor.recordCacheHit(url)
                            return withCorsHeaders(response)
                        } else {
                            if (BuildConfig.DEBUG) {
                                Log.d(TAG, "❌ WEBVIEW_CLIENT: Cache miss: $url")
                                Log.d(FLOW_TAG, "ASSET response source=network-fallback reason=cache-null online=${NetworkUtils.getCurrentStatus(context).isOnline} url=$url")
                            }
                            metricsMonitor.recordCacheMiss(url)

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
                        Log.d(TAG, "❌ STEP_5_FAIL: shouldCacheRequest result: ${shouldCacheRequest(request, url)}")
                        Log.d(TAG, "❌ STEP_5_FAIL: This request will go through normal network loading")
                    }
                }

                return null
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (url != null && url != offlineAssetUrl) {
                    offlinePageVisible = false
                    if (!isVisibleOfflineSnapshot(url)) {
                        visibleOfflineSnapshotUrl = null
                    }
                    onPageStarted?.invoke()
                }
                progressBar.visibility = View.VISIBLE
                val startTime = System.currentTimeMillis()
                view?.tag = startTime // Store start time for performance tracking
                url?.let { metricsMonitor.trackPageLoadStart(it) }
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "⏳ Page load started for: $url - Hardware Acceleration: $isHardwareAccelerationEnabled")
                    Log.d(FLOW_TAG, "PAGE started url=$url online=${NetworkUtils.getCurrentStatus(context).isOnline} offlinePageVisible=$offlinePageVisible visibleSnapshot=${visibleOfflineSnapshotUrl ?: "none"} activeOrigin=${activeOfflineRouteOrigin ?: "none"}")
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
                    Log.d(FLOW_TAG, "PAGE finished url=$url loadTimeMs=$loadTime online=${NetworkUtils.getCurrentStatus(context).isOnline} offlinePageVisible=$offlinePageVisible visibleSnapshot=${visibleOfflineSnapshotUrl ?: "none"} activeOrigin=${activeOfflineRouteOrigin ?: "none"}")
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
                    if (BuildConfig.DEBUG) {
                        Log.e(FLOW_TAG, "PAGE resource-error mainFrame=${request?.isForMainFrame} method=${request?.method} code=${error.errorCode} description=${error.description} url=${request?.url}")
                    }
                }

                val failedUrl = request?.url?.toString()
                if (request?.isForMainFrame == true && isVisibleOfflineSnapshot(failedUrl)) {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "📴 Ignoring repeated error for visible offline route snapshot: $failedUrl")
                    }
                    return
                }

                if (request?.isForMainFrame == true &&
                    failedUrl != null &&
                    failedUrl != offlineAssetUrl &&
                    !NetworkUtils.getCurrentStatus(context).isOnline
                ) {
                    view?.post {
                        showOfflineRouteOrOfflinePage(failedUrl)
                    }
                    return
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

                        // TODO: Add HTML file workflow - error.html not available yet
                        // Show error page for main frame SSL errors
                        // try {
                        //     view?.loadUrl("file:///android_asset/build/public/error.html")
                        // } catch (e: Exception) {
                        //     Log.e(TAG, "Failed to load SSL error page: ${e.message}")
                        // }
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
                    Log.d(FLOW_TAG, "CONSOLE level=${consoleMessage?.messageLevel()} line=${consoleMessage?.lineNumber()} source=${consoleMessage?.sourceId()} message=${consoleMessage?.message()}")
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
