package io.yourname.androidproject

import android.content.Context
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

class MainActivity : AppCompatActivity(), CoroutineScope by MainScope() {

    private val TAG = "CookieSync"
    private lateinit var binding: ActivityMainBinding
    private lateinit var nativeBridge: NativeBridge
    private lateinit var customWebView: CustomWebView
    private lateinit var properties: Properties
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
        Log.d(TAG, "🚀 MainActivity onCreate - App starting")
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📱 onCreate started on thread: ${Thread.currentThread().name}")
        }
        
        // Debug: Check saved URL on app start
        debugUrlPersistence()

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
            // Check for saved URL first
            val sharedPrefs = getSharedPreferences("native_state", Context.MODE_PRIVATE)
            val savedUrl = sharedPrefs.getString("__app_current_url", null)
            
            if (savedUrl != null) {
                currentUrl = savedUrl
                Log.d(TAG, "📍 Restoring saved URL: $currentUrl")
            } else {
                // Use default URL logic
                if (BuildConfig.DEBUG) {
                    val local_ip = properties.getProperty("LOCAL_IP", "localhost")
                    val port = properties.getProperty("port", "3005")
                    currentUrl = "http://$local_ip:$port"
                } else {
                    currentUrl = properties.getProperty("PRODUCTION_URL", "")
                    if (currentUrl.isEmpty()) {
                        currentUrl = "file:///android_asset/build/public/index.html"
                    }
                }
                Log.d(TAG, "📍 Loading default URL: $currentUrl")
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
        Log.d(TAG, "⏸️ onPause - App going to background")
        saveCurrentUrl()
        customWebView.onPause()
    }

    override fun onResume() {
        super.onResume()
        customWebView.onResume()
    }

    override fun onDestroy() {
        Log.d(TAG, "💀 onDestroy - App being destroyed")
        saveCurrentUrl()
        coroutineContext.cancelChildren()
        customWebView.destroy()
        super.onDestroy()
    }

    override fun onStop() {
        super.onStop()
        Log.d(TAG, "⏹️ onStop - App stopped")
        saveCurrentUrl()
    }
    
    private fun saveCurrentUrl() {
        Log.d(TAG, "📍 Saving current URL")
        
        try {
            val currentUrl = customWebView.getWebView().url
            
            if (currentUrl != null) {
                val sharedPrefs = getSharedPreferences("native_state", Context.MODE_PRIVATE)
                val currentTime = System.currentTimeMillis()
                
                val success = sharedPrefs.edit()
                    .putString("__app_current_url", currentUrl)
                    .putLong("__url_save_time", currentTime)
                    .commit()
                
                if (success) {
                    Log.d(TAG, "✅ Successfully saved URL: $currentUrl")
                    Log.d(TAG, "⏰ Save timestamp: $currentTime")
                } else {
                    Log.e(TAG, "❌ Failed to save URL to SharedPreferences")
                }
            } else {
                Log.w(TAG, "⚠️ Current URL is null, skipping save")
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "❌ Exception during URL save: ${e.message}")
        }
    }
    
    private fun debugUrlPersistence() {
        Log.d(TAG, "🔍 === URL PERSISTENCE DEBUG ===")
        
        try {
            val sharedPrefs = getSharedPreferences("native_state", Context.MODE_PRIVATE)
            val savedUrl = sharedPrefs.getString("__app_current_url", null)
            val saveTime = sharedPrefs.getLong("__url_save_time", 0)
            
            Log.d(TAG, "📍 Saved URL: $savedUrl")
            Log.d(TAG, "⏰ Save timestamp: $saveTime")
            
            if (saveTime > 0) {
                val timeSince = System.currentTimeMillis() - saveTime
                Log.d(TAG, "⏱️ Time since last save: ${timeSince}ms (${timeSince/1000}s)")
            }
            
            val isFirstLaunch = savedUrl == null
            Log.d(TAG, "🆕 Is first launch: $isFirstLaunch")
            
        } catch (e: Exception) {
            Log.e(TAG, "❌ Debug error: ${e.message}")
        }
        
        Log.d(TAG, "🔍 === END URL DEBUG ===")
    }
}