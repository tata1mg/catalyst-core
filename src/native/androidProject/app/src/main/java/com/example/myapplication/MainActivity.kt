package com.example.androidProject

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.util.Properties
import com.example.androidProject.databinding.ActivityMainBinding
import com.example.myapplication.WebCacheManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.cancelChildren
import org.json.JSONObject
import java.net.URL
import java.net.HttpURLConnection

class MainActivity : AppCompatActivity(), CoroutineScope by MainScope() {

    private val TAG = "WebViewDebug"
    private lateinit var binding: ActivityMainBinding
    private lateinit var myWebView: WebView
    private lateinit var cacheManager: WebCacheManager
    private var buildType: String = "debug"  // Default to debug
    private var cachePatterns: List<String> = emptyList()
    private var isHardwareAccelerationEnabled = false
    private lateinit var metricsMonitor: MetricsMonitor

    private fun enableHardwareAcceleration() {
        if (!isHardwareAccelerationEnabled) {
            window.setFlags(
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
            )
            myWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isHardwareAccelerationEnabled = true
            Log.d(TAG, "🚀 Hardware acceleration enabled - Thread: ${Thread.currentThread().name}")
        }
    }

    private fun disableHardwareAcceleration() {
        if (isHardwareAccelerationEnabled) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
            myWebView.setLayerType(View.LAYER_TYPE_NONE, null)
            isHardwareAccelerationEnabled = false
            Log.d(TAG, "⚫ Hardware acceleration disabled - Thread: ${Thread.currentThread().name}")
        }
    }

    data class AndroidConfig(
        val buildType: String = "debug",
        val cachePattern: String = "",
        val emulatorName: String = "",
        val sdkPath: String = ""
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "📱 onCreate started on thread: ${Thread.currentThread().name}")

        val properties = Properties()
        assets.open("webview_config.properties").use {
            properties.load(it)
        }

        val androidConfigJson = properties.getProperty("android", "{}")
        val androidConfig = try {
            val jsonObject = JSONObject(androidConfigJson)
            AndroidConfig(
                buildType = properties.getProperty("buildType", "debug"),
                cachePattern = properties.getProperty("cachePattern", ""),
                emulatorName = properties.getProperty("emulatorName", ""),
                sdkPath = properties.getProperty("sdkPath", "")
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing android config", e)
            AndroidConfig()
        }
        Log.d(TAG, "android config parsed: $androidConfig")
        buildType = androidConfig.buildType
        cachePatterns = androidConfig.cachePattern
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        Log.d(TAG, "Build type: $buildType")
        Log.d(TAG, "Cache Pattern: $cachePatterns ")

        binding = ActivityMainBinding.inflate(layoutInflater)
        supportActionBar?.hide()
        setContentView(binding.root)

        cacheManager = WebCacheManager(applicationContext)

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

        myWebView = binding.webview
        enableHardwareAcceleration() // Enable for initial UI setup

        if (savedInstanceState == null) {
            myWebView.clearCache(false)
            myWebView.clearHistory()
        } else {
            myWebView.restoreState(savedInstanceState)
        }
        metricsMonitor = MetricsMonitor.getInstance(applicationContext)
        setupWebView(properties)

        metricsMonitor.markAppStartComplete()
        val local_ip = properties.getProperty("LOCAL_IP" , "localhost")
        val port = properties.getProperty("port" , "3005")
        val loadUrl = "http://$local_ip:$port"
        makeRequest(loadUrl)
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

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        myWebView.saveState(outState)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(properties: Properties) {
        Log.d(TAG, "🌐 Setting up WebView on thread: ${Thread.currentThread().name}")

        myWebView.settings.apply {
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
        }

        myWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                request?.url?.let { url ->
                    if (url.scheme in listOf("http", "https")) {
                        view?.loadUrl(url.toString())
                        return true
                    }
                }
                return false
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val originalUrl = request.url.toString()
                Log.d(TAG, "🔄 Intercepting request for: $originalUrl on thread: ${Thread.currentThread().name}")

                if (buildType == "debug" || request.method != "GET") {
                    return null
                }

                if (!shouldCacheUrl(originalUrl)) {
                    Log.d(TAG, "⏭️ URL doesn't match cache patterns, skipping cache: $originalUrl")
                    return null
                }

                return runBlocking {
                    Log.d(TAG, "⚙️ Processing request in coroutine on thread: ${Thread.currentThread().name}")
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

                        var response = cacheManager.getCachedResponse(originalUrl, headers)

                        if (response != null) {
                            val duration = System.currentTimeMillis() - startTime
                            metricsMonitor.recordCacheHit()
                            Log.d(TAG, "✅ Served from cache in ${duration}ms: $originalUrl")
                            response
                        } else {
                            metricsMonitor.recordCacheMiss()
                            Log.d(TAG, "❌ Cache miss for: $originalUrl")
                            null
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ Error processing request for URL: $originalUrl", e)
                        e.printStackTrace()
                        null
                    } finally {
                        enableHardwareAcceleration()
                    }
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                binding.progress.visibility = View.VISIBLE
                val startTime = System.currentTimeMillis()
                view?.tag = startTime // Store start time for performance tracking
                url?.let { metricsMonitor.trackPageLoadStart(it) }
                Log.d(TAG, "⏳ Page load started for: $url - Hardware Acceleration: $isHardwareAccelerationEnabled")
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                binding.progress.visibility = View.GONE
                url?.let { metricsMonitor.trackPageLoadEnd(it) }
                val startTime = view?.tag as? Long ?: return
                val loadTime = System.currentTimeMillis() - startTime
                Log.d(TAG, "✅ Page load finished for: $url - Load time: ${loadTime}ms - Hardware Acceleration: $isHardwareAccelerationEnabled")
                view?.clearHistory()
                view?.saveState(Bundle())
                super.onPageFinished(view, url)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                error?.let {
                    Log.e(TAG, "❌ Error loading ${request?.url}: ${it.errorCode} ${it.description}")
                }
                super.onReceivedError(view, request, error)
            }
        }

        myWebView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, progress: Int) {
                binding.progress.progress = progress
                if (progress == 100) {
                    binding.progress.visibility = View.GONE
                }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                Log.d(TAG, "Console: ${consoleMessage?.message()} -- From line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                return true
            }
        }

        WebView.setWebContentsDebuggingEnabled(true)
    }

    private fun makeRequest(url: String?) {
        binding.webview.scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
        url?.let { myWebView.loadUrl(it) }
    }

    override fun onBackPressed() {
        if (myWebView.canGoBack()) {
            myWebView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onPause() {
        super.onPause()
        myWebView.onPause()
    }

    override fun onResume() {
        metricsMonitor.logAllMetrics()
        super.onResume()
        myWebView.onResume()
    }

    override fun onDestroy() {
        metricsMonitor.logAllMetrics()
        metricsMonitor.cleanup()

        coroutineContext.cancelChildren()
        myWebView.destroy()
        super.onDestroy()
    }
}
