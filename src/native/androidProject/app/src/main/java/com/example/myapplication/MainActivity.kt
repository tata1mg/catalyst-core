package com.example.androidProject

import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import java.util.Properties
import com.example.androidProject.databinding.ActivityMainBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancelChildren

class MainActivity : AppCompatActivity(), CoroutineScope by MainScope() {

    private val TAG = "WebViewDebug"
    private lateinit var binding: ActivityMainBinding
    private lateinit var customWebView: CustomWebView
    private lateinit var properties: Properties
    private lateinit var metricsMonitor: MetricsMonitor
    private var isHardwareAccelerationEnabled = false
    private var currentUrl: String = ""
    private val appStartTime = System.currentTimeMillis() // Track app start time

    private fun enableHardwareAcceleration() {
        if (!isHardwareAccelerationEnabled) {
            window.setFlags(
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
            )
            isHardwareAccelerationEnabled = true
            Log.d(TAG, "🚀 Hardware acceleration enabled for window - Thread: ${Thread.currentThread().name}")
        }
    }

    private fun disableHardwareAcceleration() {
        if (isHardwareAccelerationEnabled) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
            isHardwareAccelerationEnabled = false
            Log.d(TAG, "⚫ Hardware acceleration disabled for window - Thread: ${Thread.currentThread().name}")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "📱 onCreate started on thread: ${Thread.currentThread().name}")

        // Initialize metrics monitor
        metricsMonitor = MetricsMonitor.getInstance(applicationContext)

        // Log app startup time
        val startupTime = System.currentTimeMillis() - appStartTime
        Log.d(TAG, "⏱️ App startup time to onCreate: ${startupTime}ms")

        // Load properties
        properties = Properties()
        assets.open("webview_config.properties").use {
            properties.load(it)
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
            customWebView.restoreState(savedInstanceState)
        }

        // Clean the cache
        customWebView.cleanupCache()

        // Setup refresh button
        val local_ip = properties.getProperty("LOCAL_IP", "localhost")
        val port = properties.getProperty("port", "3005")
        currentUrl = "http://$local_ip:$port"

        // Set debug info text
        binding.debugInfo.text = "Debug: $local_ip:$port"

        // Set up refresh button click listener
        binding.btnRefresh.setOnClickListener {
            Log.d(TAG, "♻️ Refresh button clicked")
            customWebView.refresh(currentUrl)
        }

        // Load URL
        customWebView.loadUrl(currentUrl)

        // Mark app start complete
        metricsMonitor.markAppStartComplete()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        customWebView.saveState(outState)
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
        try {
            // Explicitly log metrics before destroying
            Log.e(TAG, "🔚 Activity is being destroyed - logging final metrics")

            // Log directly and also call cleanup
            metricsMonitor.logAllMetrics()
            metricsMonitor.cleanup()

            coroutineContext.cancelChildren()
            customWebView.destroy()
        } catch (e: Exception) {
            // Make sure we see any errors that might prevent logging
            Log.e(TAG, "❌ Error during onDestroy: ${e.message}", e)
        } finally {
            // Always call super.onDestroy() in a finally block
            super.onDestroy()
        }
    }
}