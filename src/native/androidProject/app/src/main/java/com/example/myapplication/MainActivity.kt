package com.example.androidProject

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.View
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

    data class AndroidConfig(
        val buildType: String = "debug",
        val cachePattern: String = "",
        val emulatorName: String = "",
        val sdkPath: String = ""
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val properties = Properties()
        assets.open("webview_config.properties").use {
            properties.load(it)
        }

        // Parse android config from JSON string
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

        // Clean up expired cache entries
        launch(Dispatchers.IO) {
            cacheManager.cleanup()
        }

        myWebView = binding.webview

        // Clear any existing WebView data if this is a fresh start
        if (savedInstanceState == null) {
            myWebView.clearCache(false) // false means we keep files marked as "cache-control: no-cache"
            myWebView.clearHistory()
        } else {
            myWebView.restoreState(savedInstanceState)
        }

        setupWebView(properties)

        val local_ip = properties.getProperty("LOCAL_IP" , "localhost")
        val port = properties.getProperty("port" , "3005")
        val loadUrl = "http://$local_ip:$port"
        makeRequest(loadUrl)
    }

    private fun shouldCacheUrl(url: String): Boolean {
        // If no patterns specified, don't cache anything
        if (cachePatterns.isEmpty()) return false

        // Convert the wildcard pattern to a regex pattern
        fun String.wildcardToRegex(): String {
            return this.replace(".", "\\.")  // Escape dots
                .replace("*", ".*")   // Convert * to .*
                .let { "^$it$" }      // Anchor pattern
        }

        // Check if URL matches any of the patterns
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
        myWebView.settings.apply {
            javaScriptEnabled = true
            loadsImagesAutomatically = true
            mixedContentMode = if (BuildConfig.ALLOW_MIXED_CONTENT) {
                WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            } else {
                WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }

            // Enable standard caching
            cacheMode = WebSettings.LOAD_DEFAULT // This will use both RAM and disk cache

            databaseEnabled = true
            domStorageEnabled = true

            // Enable file access
            allowFileAccess = true
            allowContentAccess = true
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
                Log.d(TAG, "Intercepting request for: $originalUrl")

                if ( buildType == "debug" || request.method != "GET") {
                    return null
                }

                // Check if URL matches patterns
                if (!shouldCacheUrl(originalUrl)) {
                    Log.d(TAG, "URL doesn't match cache patterns, skipping cache: $originalUrl")
                    return null
                }

                return runBlocking {
                    try {
                        // Add cache control headers
                        val headers = request.requestHeaders.toMutableMap().apply {
                            if (!containsKey("Cache-Control")) {
                                put("Cache-Control", "max-age=86400") // 24 hours
                            }
                            if (!containsKey("Pragma")) {
                                put("Pragma", "cache")
                            }
                        }

                        // Try to get from cache first
                        var response = cacheManager.getCachedResponse(originalUrl, headers)

                        if (response != null) {
                                Log.d(TAG, "📱 Serving from cache: $originalUrl")
                                response
                        } else {
                            Log.d(TAG, "Cache Manager unable to return response : $originalUrl")
                            null
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ Error processing request for URL: $originalUrl", e)
                        e.printStackTrace()
                        null
                    }
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                binding.progress.visibility = View.VISIBLE
                Log.d(TAG, "⏳ Page started loading: $url")
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                binding.progress.visibility = View.GONE
                Log.d(TAG, "✅ Page finished loading: $url")
                // Save to WebView's back/forward list
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
        super.onResume()
        myWebView.onResume()
    }

    override fun onDestroy() {
        super.onDestroy()
        myWebView.destroy()
    }

//    external fun stringFromJNI(): String

//    companion object {
//        init {
//            System.loadLibrary("native-lib")
//        }
//    }
}
