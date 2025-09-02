package io.yourname.androidproject

import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import java.util.Properties
import io.yourname.androidproject.databinding.ActivityMainBinding
import io.yourname.androidproject.NativeBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancelChildren
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : AppCompatActivity(), CoroutineScope by MainScope() {

    private val TAG = "WebViewDebug"
    private lateinit var binding: ActivityMainBinding
    private lateinit var nativeBridge: NativeBridge
    private lateinit var customWebView: CustomWebView
    private lateinit var properties: Properties
    private var isHardwareAccelerationEnabled = false
    private var currentUrl: String = ""
    private var splashStartTime: Long = 0

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
        val splashScreen = installSplashScreen()
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

        // Configure splash screen
        splashStartTime = System.currentTimeMillis()
        configureSplashScreen(splashScreen)

        // Setup UI
        binding = ActivityMainBinding.inflate(layoutInflater)
        supportActionBar?.hide()
        setContentView(binding.root)

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
            nativeBridge = NativeBridge(this, customWebView.getWebView())
            customWebView.addJavascriptInterface(nativeBridge, "NativeBridge")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NativeBridge: ${e.message}")
        }
        
        // Load URL based on environment
        try {
            if (BuildConfig.DEBUG) {
                // Use the local development server in debug mode
                val local_ip = properties.getProperty("LOCAL_IP", "localhost")
                val port = properties.getProperty("port", "3005")
                val protocol = properties.getProperty("protocol", "http")
                currentUrl = "$protocol://$local_ip:$port"
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

    override fun onBackPressed() {
        if (customWebView.canGoBack()) {
            customWebView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onPause() {
        super.onPause()
        customWebView.onPause()
    }

    override fun onResume() {
        super.onResume()
        customWebView.onResume()
    }

    override fun onDestroy() {
        coroutineContext.cancelChildren()
        customWebView.destroy()
        super.onDestroy()
    }

    private fun configureSplashScreen(splashScreen: androidx.core.splashscreen.SplashScreen) {
        val durationProperty = properties.getProperty("splashScreen.duration")
        
        splashScreen.setKeepOnScreenCondition {
            val webViewLoaded = ::customWebView.isInitialized && 
                               customWebView.getWebView().progress >= 100
            
            if (durationProperty != null) {
                val duration = durationProperty.toLong()
                val timeElapsed = System.currentTimeMillis() - splashStartTime >= duration
                !timeElapsed
            } else {
                !webViewLoaded
            }
        }
    }
}