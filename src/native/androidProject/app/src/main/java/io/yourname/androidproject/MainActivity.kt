package io.yourname.androidproject

import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

import java.util.Properties
import io.yourname.androidproject.databinding.ActivityMainBinding
import io.yourname.androidproject.NativeBridge
import io.yourname.androidproject.utils.KeyboardUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancelChildren

class MainActivity : AppCompatActivity(), CoroutineScope by MainScope() {

    private val TAG = "WebViewDebug"
    private lateinit var binding: ActivityMainBinding
    private lateinit var nativeBridge: NativeBridge
    private lateinit var customWebView: CustomWebView
    private lateinit var properties: Properties
    private lateinit var metricsMonitor: MetricsMonitor
    private lateinit var keyboardUtil: KeyboardUtil
    private var isHardwareAccelerationEnabled = false
    private var currentUrl: String = ""

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📱 onCreate started on thread: ${Thread.currentThread().name}")
        }

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
        
        // Load URL based on environment
        try {
            if (BuildConfig.DEBUG) {
                // Use the local development server in debug mode
                val local_ip = properties.getProperty("LOCAL_IP", "localhost")
                val initial_url = properties.getProperty("initial_url", "")
                val port = properties.getProperty("port", "3005")
                val useHttps = properties.getProperty("useHttps", "false").toBoolean()
                val protocol = if (useHttps) "https" else "http"
                currentUrl = "$protocol://$local_ip:$port/$initial_url"
            } else {
                // In production, use the configured production URL or fallback to a file:// URL
                currentUrl = properties.getProperty("PRODUCTION_URL", "")
                if (currentUrl.isEmpty()) {
                    // If no production URL is configured, load the local index.html
                    currentUrl = "file:///android_asset/build/public/index.html"
                }
            }
            
            // Load URL
            customWebView.loadUrl(currentUrl)
            metricsMonitor.markAppStartComplete()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load initial URL: ${e.message}")
            // Fallback to local asset as a last resort
            customWebView.loadUrl("file:///android_asset/build/public/error.html")
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

        coroutineContext.cancelChildren()
        customWebView.destroy()
        super.onDestroy()
    }
}