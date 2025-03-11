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
import java.net.URL                 
import java.net.HttpURLConnection

class MainActivity : AppCompatActivity(), CoroutineScope by MainScope() {

    private val TAG = "WebViewDebug"
    private lateinit var binding: ActivityMainBinding
    private lateinit var myWebView: WebView
    private lateinit var cacheManager: WebCacheManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val properties = Properties()
        assets.open("webview_config.properties").use {
            properties.load(it)
        }

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
                return null
                // Don't cache if it's not a GET request
                if (request.method != "GET") {
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
                            // If not in cache, let WebView handle the request
                            // The cacheManager will intercept and cache the response
                            Log.d(TAG, "💾 Cache miss, fetching and caching: $originalUrl")
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