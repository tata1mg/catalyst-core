package io.yourname.androidproject

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat

import org.json.JSONObject
import java.util.Properties
import io.yourname.androidproject.databinding.ActivityMainBinding
import io.yourname.androidproject.NativeBridge
import io.yourname.androidproject.utils.BridgeUtils
import io.yourname.androidproject.utils.KeyboardUtil
import io.yourname.androidproject.utils.NetworkUtils
import io.yourname.androidproject.utils.NotificationConstants
import io.yourname.androidproject.utils.SafeAreaInsets
import io.yourname.androidproject.utils.SafeAreaUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancelChildren

class MainActivity : AppCompatActivity(), CoroutineScope by MainScope() {

    companion object {
        private const val TAG = "WebViewDebug"
        private const val PREFS_NAME = "safe_area_prefs"
        private const val PREF_SAFE_AREA_TOP = "safe_area_top"
        private const val PREF_SAFE_AREA_RIGHT = "safe_area_right"
        private const val PREF_SAFE_AREA_BOTTOM = "safe_area_bottom"
        private const val PREF_SAFE_AREA_LEFT = "safe_area_left"
        private const val PREF_SAFE_AREA_CACHED = "safe_area_cached"
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var nativeBridge: NativeBridge
    private lateinit var customWebView: CustomWebView
    lateinit var properties: Properties
    private lateinit var metricsMonitor: MetricsMonitor
    private lateinit var keyboardUtil: KeyboardUtil
    private var isHardwareAccelerationEnabled = false
    private var currentUrl: String = ""
    private var edgeToEdgeEnabled = false
    private var latestSafeAreaInsets: SafeAreaInsets = SafeAreaInsets.ZERO

    private fun enableHardwareAcceleration() {
        if (!isHardwareAccelerationEnabled) {
            window.setFlags(
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
            )
            isHardwareAccelerationEnabled = true
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "🚀 Hardware acceleration enabled for window - Thread: ${Thread.currentThread().name}")
            }
        }
    }

    private fun disableHardwareAcceleration() {
        if (isHardwareAccelerationEnabled) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
            isHardwareAccelerationEnabled = false
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "⚫ Hardware acceleration disabled for window - Thread: ${Thread.currentThread().name}")
            }
        }
    }

    private fun configureEdgeToEdge() {
        edgeToEdgeEnabled = properties
            .getProperty("edgeToEdge.enabled", "false")
            .equals("true", ignoreCase = true)

        if (edgeToEdgeEnabled) {
            WindowCompat.setDecorFitsSystemWindows(window, false)
        } else {
            WindowCompat.setDecorFitsSystemWindows(window, true)
        }
    }

    private fun setupSafeAreaHandling() {
        val rootView = binding.root
        val cachedInsets = loadCachedSafeAreaInsets()

        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📋 Cache lookup result: $cachedInsets")
        }

        if (cachedInsets != null) {
            latestSafeAreaInsets = cachedInsets
            customWebView.setDefaultRequestHeaders(buildSafeAreaHeaders())

            if (BuildConfig.DEBUG) {
                Log.d(TAG, "✅ Using cached safe area insets: $cachedInsets")
            }
        } else {
            val initialInsets = SafeAreaUtils.getSafeAreaInsets(window, rootView, edgeToEdgeEnabled)
            latestSafeAreaInsets = initialInsets
            customWebView.setDefaultRequestHeaders(buildSafeAreaHeaders())

            if (BuildConfig.DEBUG) {
                Log.d(TAG, "🆕 No cache found - initial insets: $initialInsets")
            }
        }

        rootView.post {
            val postLayoutInsets = SafeAreaUtils.getSafeAreaInsets(window, rootView, edgeToEdgeEnabled)

            if (postLayoutInsets != latestSafeAreaInsets) {
                latestSafeAreaInsets = postLayoutInsets
                customWebView.setDefaultRequestHeaders(buildSafeAreaHeaders())
                notifySafeAreaUpdate(postLayoutInsets)

                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "🔄 Updated safe area insets: $postLayoutInsets")
                }
            }

            // Save to cache if not already cached or if values changed
            if (cachedInsets == null || cachedInsets != postLayoutInsets) {
                saveSafeAreaInsetsToCache(postLayoutInsets)
            }
        }
    }

    private fun buildSafeAreaHeaders(): Map<String, String> = mapOf(
        "X-Safe-Area-Top" to latestSafeAreaInsets.top.toString(),
        "X-Safe-Area-Right" to latestSafeAreaInsets.right.toString(),
        "X-Safe-Area-Bottom" to latestSafeAreaInsets.bottom.toString(),
        "X-Safe-Area-Left" to latestSafeAreaInsets.left.toString(),
        // Prevent caching of SSR response so updated headers are always used
        "Cache-Control" to "no-cache, no-store, must-revalidate",
        "Pragma" to "no-cache"
    )

    // Public method for NativeBridge to get current safe area insets
    fun getCurrentSafeAreaInsets(): SafeAreaInsets = latestSafeAreaInsets

    /**
     * Notify WebView when safe area insets are updated
     * Called when deferred inset calculation completes
     */
    private fun notifySafeAreaUpdate(insets: SafeAreaInsets) {
        if (::nativeBridge.isInitialized && ::customWebView.isInitialized) {
            val insetsJson = org.json.JSONObject().apply {
                put("top", insets.top)
                put("right", insets.right)
                put("bottom", insets.bottom)
                put("left", insets.left)
            }

            BridgeUtils.notifyWebJson(
                customWebView.getWebView(),
                BridgeUtils.WebEvents.ON_SAFE_AREA_INSETS_UPDATED,
                insetsJson
            )

            if (BuildConfig.DEBUG) {
                Log.d(TAG, "📐 Safe area insets updated and sent to WebView: $insets")
            }
        }
    }

    /**
     * Load cached safe area insets from SharedPreferences
     * Returns null if no cache exists
     */
    private fun loadCachedSafeAreaInsets(): SafeAreaInsets? {
        val prefs = getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)

        if (!prefs.getBoolean(PREF_SAFE_AREA_CACHED, false)) {
            return null
        }

        return SafeAreaInsets(
            top = prefs.getInt(PREF_SAFE_AREA_TOP, 0),
            right = prefs.getInt(PREF_SAFE_AREA_RIGHT, 0),
            bottom = prefs.getInt(PREF_SAFE_AREA_BOTTOM, 0),
            left = prefs.getInt(PREF_SAFE_AREA_LEFT, 0)
        )
    }

    /**
     * Save safe area insets to SharedPreferences for future launches
     * Only saves if insets contain at least one non-zero value
     */
    private fun saveSafeAreaInsetsToCache(insets: SafeAreaInsets) {
        // Only cache if we have meaningful (non-zero) values
        // This prevents caching zeros from incomplete initialization
        if (insets.top == 0 && insets.right == 0 && insets.bottom == 0 && insets.left == 0) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "⚠️ Skipping cache save - all insets are zero")
            }
            return
        }

        val saved = getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE).edit().apply {
            putInt(PREF_SAFE_AREA_TOP, insets.top)
            putInt(PREF_SAFE_AREA_RIGHT, insets.right)
            putInt(PREF_SAFE_AREA_BOTTOM, insets.bottom)
            putInt(PREF_SAFE_AREA_LEFT, insets.left)
            putBoolean(PREF_SAFE_AREA_CACHED, true)
        }.commit()  // Use commit() instead of apply() to ensure immediate persistence

        if (BuildConfig.DEBUG) {
            if (saved) {
                // Verify by reading back immediately
                val prefs = getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
                val verified = SafeAreaInsets(
                    top = prefs.getInt(PREF_SAFE_AREA_TOP, -1),
                    right = prefs.getInt(PREF_SAFE_AREA_RIGHT, -1),
                    bottom = prefs.getInt(PREF_SAFE_AREA_BOTTOM, -1),
                    left = prefs.getInt(PREF_SAFE_AREA_LEFT, -1)
                )
                Log.d(TAG, "💾 Cached safe area insets: $insets")
                Log.d(TAG, "✓ Verified cached values: $verified")
            } else {
                Log.e(TAG, "❌ Failed to cache safe area insets: $insets")
            }
        }
    }

    private fun loadUrlWithSafeArea(url: String) {
        // Set headers with current safe area insets
        customWebView.setDefaultRequestHeaders(buildSafeAreaHeaders())
        // Load URL with safe area headers
        customWebView.loadUrl(url)

        if (BuildConfig.DEBUG) {
            Log.d(TAG, "🔄 Loading URL with safe area headers: $latestSafeAreaInsets")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Load properties
        properties = Properties()
        try {
            assets.open("webview_config.properties").use {
                properties.load(it)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load properties: ${e.message}")
            // Fall back to default properties if the file doesn't exist
            properties.setProperty("buildType", if (BuildConfig.DEBUG) "debug" else "release")
            properties.setProperty("buildOptimisation", (!BuildConfig.DEBUG).toString())
        }

        configureEdgeToEdge()

        // Initialize MetricsMonitor
        metricsMonitor = MetricsMonitor.getInstance(this)

        // Setup UI
        binding = ActivityMainBinding.inflate(layoutInflater)
        supportActionBar?.hide()
        setContentView(binding.root)
        
        // Initialize keyboard utility
        keyboardUtil = KeyboardUtil(this, binding.webviewContainer)
        keyboardUtil.initialize()
        
        // Enable hardware acceleration for the window
        enableHardwareAcceleration()

        // Initialize CustomWebView
        customWebView = CustomWebView(
            context = this,
            webView = binding.webview,
            progressBar = binding.progress,
            properties = properties
        )

        // Handle state restoration
        if (savedInstanceState == null) {
            customWebView.clearCache()
        } else {
            try {
                customWebView.restoreState(savedInstanceState)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to restore WebView state: ${e.message}")
                customWebView.clearCache()
            }
        }

        // Clean the cache
        customWebView.cleanupCache()

        // Setup NativeBridge
        try {
            nativeBridge = NativeBridge(this, customWebView.getWebView(), properties)
            customWebView.addJavascriptInterface(nativeBridge, "NativeBridge")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NativeBridge: ${e.message}")
        }

        setupSafeAreaHandling()

        // Setup back press handler (modern API)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customWebView.canGoBack()) {
                    customWebView.goBack()
                } else {
                    // Disable this callback and let the system handle back press
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
        
        // Load URL based on environment and deep link data
        try {
                // Use the local development server in debug mode
                val local_ip = properties.getProperty("LOCAL_IP", "localhost")
                val initial_url = properties.getProperty("initial_url", "")
                val port = properties.getProperty("port", "3005")
                val useHttps = properties.getProperty("useHttps", "false").toBoolean()
                val protocol = if (useHttps) "https" else "http"
                currentUrl = "$protocol://$local_ip:$port/$initial_url"
                customWebView.updateLastTargetUrl(currentUrl)
            

            // Check for notification and handle via /notification endpoint
            if (intent.getBooleanExtra(NotificationConstants.EXTRA_IS_NOTIFICATION, false)) {
                handleNotificationClick(currentUrl, intent)
            } else {
                val isOnline = NetworkUtils.getCurrentStatus(this).isOnline
                if (isOnline) {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "🔗 Loading base URL: $currentUrl")
                    }
                    loadUrlWithSafeArea(currentUrl)
                } else {
                    if (BuildConfig.DEBUG) {
                        Log.w(TAG, "📴 Device offline on launch, showing offline page")
                    }
                    customWebView.showOfflinePage()
                }
            }

            metricsMonitor.markAppStartComplete()

        } catch (e: Exception) {
            Log.e(TAG, "Failed to load initial URL: ${e.message}")
            // TODO: Add HTML file workflow - error.html not available yet
            // Fallback to local asset as a last resort
            // customWebView.loadUrl("file:///android_asset/build/public/error.html")
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // Handle notification click when app is already running
        intent?.let { newIntent ->
            if (newIntent.getBooleanExtra(NotificationConstants.EXTRA_IS_NOTIFICATION, false)) {
                handleNotificationClick(currentUrl, newIntent)
            } else {
                Log.d(TAG, "🔗 onNewIntent - Loading base URL: $currentUrl")
                loadUrlWithSafeArea(currentUrl)
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        try {
            customWebView.saveState(outState)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save WebView state: ${e.message}")
        }
    }

    override fun onPause() {
        super.onPause()
        customWebView.onPause()

        // Log metrics on pause in case onDestroy isn't called
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "⏸️ App paused - logging current metrics...")
            metricsMonitor.logAllMetrics()
        }
    }

    override fun onResume() {
        super.onResume()
        customWebView.onResume()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (::nativeBridge.isInitialized) {
            nativeBridge.handlePermissionResult(requestCode, permissions, grantResults)
        }
    }

    override fun onDestroy() {
        // Log all performance metrics before destroying
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "🏁 App shutting down - logging final metrics...")
        }
        metricsMonitor.logAllMetrics()
        metricsMonitor.cleanup()

        // Cleanup NativeBridge resources (stops FrameworkServer, cancels coroutines)
        if (::nativeBridge.isInitialized) {
            nativeBridge.cleanup()
        }

        // Cleanup keyboard utility
        if (::keyboardUtil.isInitialized) {
            keyboardUtil.cleanup()
        }
        if (::nativeBridge.isInitialized) {
            nativeBridge.cleanup()
        }
        coroutineContext.cancelChildren()
        customWebView.destroy()
        super.onDestroy()
    }

    /**
     * Handle notification click by navigating to /notification route
     * Ultra-simple approach: always go to /notification with minimal params
     */
    private fun handleNotificationClick(baseUrl: String, intent: Intent) {
        try {
            val action = intent.getStringExtra(NotificationConstants.EXTRA_ACTION)
            val notificationData = intent.getStringExtra(NotificationConstants.EXTRA_NOTIFICATION_DATA)
            val notificationId = intent.getStringExtra(NotificationConstants.EXTRA_NOTIFICATION_ID)

            Log.d(TAG, "🔔 Handling notification click - Action: ${action ?: "none"}")

            // Dismiss the notification
            val notificationManager = getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            if (!notificationId.isNullOrBlank()) {
                notificationManager.cancel(notificationId.hashCode())
            } else {
                notificationManager.cancelAll() // Fallback if we didn't get an ID
            }

            // Build simple /notification URL
            val url = buildNotificationUrl(baseUrl, action, notificationData)
            Log.d(TAG, "🔔 Navigating to: $url")

            // Notify web layer about the action/tap
            try {
                val payload = org.json.JSONObject().apply {
                    put("action", action ?: "tap")
                    put("deepLinkURL", url)
                    if (!notificationData.isNullOrBlank()) {
                        put("data", org.json.JSONObject(notificationData))
                    }
                    if (!notificationId.isNullOrBlank()) {
                        put("notificationId", notificationId)
                    }
                }
                val webView = customWebView.getWebView()
                if (action.isNullOrBlank()) {
                    BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_TAPPED, payload.toString())
                } else {
                    BridgeUtils.notifyWeb(webView, BridgeUtils.WebEvents.NOTIFICATION_ACTION_PERFORMED, payload.toString())
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to notify web of notification action", e)
            }

            customWebView.updateLastTargetUrl(url)
            val isOnline = NetworkUtils.getCurrentStatus(this).isOnline
            if (isOnline) {
                loadUrlWithSafeArea(url)
            } else {
                Log.w(TAG, "📴 Offline during notification click, showing offline page")
                customWebView.showOfflinePage()
            }

        } catch (e: Exception) {
            Log.e(TAG, "🔔 Error handling notification click: ${e.message}", e)
            loadUrlWithSafeArea(baseUrl)
        }
    }

    /**
     * Build ultra-simple /notification URL
     */
    private fun buildNotificationUrl(baseUrl: String, action: String?, notificationData: String?): String {
        return try {
            val url = StringBuilder("$baseUrl/notification")
            val params = mutableListOf<String>()

            // Add action if present
            if (!action.isNullOrEmpty()) {
                params.add("action=${java.net.URLEncoder.encode(action, "UTF-8")}")
            }

            // Add data if present
            if (!notificationData.isNullOrEmpty()) {
                params.add("data=${java.net.URLEncoder.encode(notificationData, "UTF-8")}")
            }

            if (params.isNotEmpty()) {
                url.append("?").append(params.joinToString("&"))
            }

            url.toString()

        } catch (e: Exception) {
            Log.e(TAG, "Error building notification URL: ${e.message}", e)
            "$baseUrl/notification"
        }
    }
}
