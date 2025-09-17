package io.yourname.androidproject

import android.graphics.Rect
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
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
    
    // Keyboard and WebView resize handling
    private var originalWebViewHeight: Int = 0
    private var isKeyboardVisible = false
    private var keyboardHeight = 0
    private lateinit var rootView: View
    private var globalLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    

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
        
        // Setup keyboard detection
        setupKeyboardDetection()
        

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
                val useHttps = properties.getProperty("useHttps", "false").toBoolean()
                val protocol = if (useHttps) "https" else "http"
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
        // Clean up keyboard detection listener
        globalLayoutListener?.let {
            if (::rootView.isInitialized) {
                rootView.viewTreeObserver.removeOnGlobalLayoutListener(it)
            }
        }
        
        coroutineContext.cancelChildren()
        if (::customWebView.isInitialized) {
            customWebView.destroy()
        }
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
    
    /**
     * Setup keyboard visibility detection and WebView resizing
     */
    private fun setupKeyboardDetection() {
        // Set window soft input mode to pan (not resize, we'll handle it manually)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN)
        
        // Get root view for keyboard detection
        rootView = findViewById<ViewGroup>(android.R.id.content)
        
        // Store original WebView container height
        binding.webviewContainer.post {
            originalWebViewHeight = binding.webviewContainer.height
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Original WebView container height: $originalWebViewHeight")
            }
        }
        
        // Setup global layout listener for keyboard detection
        globalLayoutListener = ViewTreeObserver.OnGlobalLayoutListener {
            detectKeyboardVisibility()
        }
        
        rootView.viewTreeObserver.addOnGlobalLayoutListener(globalLayoutListener)
        
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Keyboard detection setup completed")
        }
    }
    
    /**
     * Detect keyboard visibility and handle WebView resizing
     */
    private fun detectKeyboardVisibility() {
        val rect = Rect()
        rootView.getWindowVisibleDisplayFrame(rect)
        
        val screenHeight = resources.displayMetrics.heightPixels
        val visibleHeight = rect.height()
        val heightDifference = screenHeight - visibleHeight
        
        // Consider keyboard visible if height difference is more than 200dp
        val keyboardThreshold = (200 * resources.displayMetrics.density).toInt()
        val newKeyboardVisible = heightDifference > keyboardThreshold
        val newKeyboardHeight = if (newKeyboardVisible) heightDifference else 0
        
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Keyboard detection: screenHeight=$screenHeight, visibleHeight=$visibleHeight, " +
                    "heightDifference=$heightDifference, threshold=$keyboardThreshold")
        }
        
        // Only process if keyboard state changed significantly
        if (newKeyboardVisible != isKeyboardVisible || Math.abs(newKeyboardHeight - keyboardHeight) > 50) {
            isKeyboardVisible = newKeyboardVisible
            keyboardHeight = newKeyboardHeight
            
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Keyboard visibility changed: visible=$isKeyboardVisible, height=$keyboardHeight")
            }
            
            // Handle WebView resizing with a small delay to ensure layout is stable
            rootView.post {
                handleKeyboardVisibilityChange()
            }
        }
    }
    
    /**
     * Handle keyboard visibility changes and resize WebView accordingly
     */
    private fun handleKeyboardVisibilityChange() {
        if (!::customWebView.isInitialized) return
        
        if (isKeyboardVisible) {
            // Keyboard is visible - resize WebView
            resizeWebViewForKeyboard()
        } else {
            // Keyboard is hidden - restore WebView size
            restoreWebViewSize()
        }
        
        // Notify CustomWebView about keyboard state
        customWebView.onKeyboardVisibilityChanged(isKeyboardVisible, keyboardHeight)
    }
    
    /**
     * Resize WebView when keyboard is visible
     */
    private fun resizeWebViewForKeyboard() {
        val webViewContainer = binding.webviewContainer
        val layoutParams = webViewContainer.layoutParams as androidx.constraintlayout.widget.ConstraintLayout.LayoutParams
        
        // Calculate new height (original height minus keyboard height)
        val newHeight = originalWebViewHeight - keyboardHeight
        
        if (newHeight > 0 && layoutParams.height != newHeight) {
            layoutParams.height = newHeight
            webViewContainer.layoutParams = layoutParams
            
            // Enable scrolling on WebView
            binding.webview.isVerticalScrollBarEnabled = true
            binding.webview.isScrollbarFadingEnabled = true
            
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "WebView container resized for keyboard: height=$newHeight")
            }
        }
    }
    
    /**
     * Restore WebView to original size when keyboard is hidden
     */
    private fun restoreWebViewSize() {
        val webViewContainer = binding.webviewContainer
        val layoutParams = webViewContainer.layoutParams as androidx.constraintlayout.widget.ConstraintLayout.LayoutParams
        
        if (layoutParams.height != originalWebViewHeight) {
            layoutParams.height = originalWebViewHeight
            webViewContainer.layoutParams = layoutParams
            
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "WebView container size restored: height=$originalWebViewHeight")
            }
        }
    }
    
    /**
     * Get current keyboard height
     */
    fun getKeyboardHeight(): Int = keyboardHeight
    
    /**
     * Check if keyboard is currently visible
     */
    fun isKeyboardCurrentlyVisible(): Boolean = isKeyboardVisible
    
}