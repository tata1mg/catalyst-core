package com.example.androidProject

import android.content.Context
import android.util.Log
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.ConcurrentHashMap

/**
 * MetricsMonitor - A singleton class to monitor and log performance metrics for WebView
 */
class MetricsMonitor private constructor(private val context: Context) {
    private val TAG = "WebViewMetrics"

    // Application startup time
    private val appStartTime = System.currentTimeMillis()
    private var webViewInstanceCreationTime = 0L
    private var appStartCompleteTime = 0L

    // Page load metrics
    private val pageLoadStartTimes = ConcurrentHashMap<String, Long>()
    private val pageLoadEndTimes = ConcurrentHashMap<String, Long>()
    private val fcpTimes = ConcurrentHashMap<String, Long>()

    // Bundle size
    private var bundleSize = 0L

    // Page load source tracking
    private var initialPageLoadedFromAssets = false

    // Network calls tracking
    private val totalNetworkCalls = AtomicInteger(0)
    private val assetLoadAttempts = AtomicInteger(0)
    private val assetLoadSuccesses = AtomicInteger(0)
    private val apiCalls = AtomicInteger(0)

    // Cache metrics
    private val cacheHits = AtomicInteger(0)
    private val cacheMisses = AtomicInteger(0)

    // Service worker information
    private var serviceWorkerActive = false
    private var serviceWorkerControlledPageCount = 0

    companion object {
        @Volatile
        private var instance: MetricsMonitor? = null

        fun getInstance(context: Context): MetricsMonitor {
            return instance ?: synchronized(this) {
                instance ?: MetricsMonitor(context.applicationContext).also { instance = it }
            }
        }
    }

    fun markWebViewInstanceCreationTime() {
        webViewInstanceCreationTime = System.currentTimeMillis() - appStartTime
        Log.d(TAG, "⏱️ WebView instance creation time: ${webViewInstanceCreationTime}ms")
    }

    fun markAppStartComplete() {
        appStartCompleteTime = System.currentTimeMillis() - appStartTime
        Log.d(TAG, "⏱️ App start complete time: ${appStartCompleteTime}ms")
    }

    fun setInitialPageLoadedFromAssets(fromAssets: Boolean) {
        initialPageLoadedFromAssets = fromAssets
        Log.d(TAG, "📱 Initial page loaded from assets: $fromAssets")
    }

    fun trackPageLoadStart(url: String) {
        pageLoadStartTimes[url] = System.currentTimeMillis()
    }

    fun trackPageLoadEnd(url: String) {
        val startTime = pageLoadStartTimes[url] ?: return
        val loadTime = System.currentTimeMillis() - startTime
        pageLoadEndTimes[url] = loadTime

        val truePLT = webViewInstanceCreationTime + loadTime
        Log.d(TAG, "⏱️ Page load time for $url: ${loadTime}ms (True PLT: ${truePLT}ms)")
    }

    fun recordFirstContentfulPaint(url: String) {
        val startTime = pageLoadStartTimes[url] ?: return
        val fcpTime = System.currentTimeMillis() - startTime
        fcpTimes[url] = fcpTime

        val trueFCP = webViewInstanceCreationTime + fcpTime
        Log.d(TAG, "⏱️ First Contentful Paint for $url: ${fcpTime}ms (True FCP: ${trueFCP}ms)")
    }

    fun recordNetworkCall(url: String, isApi: Boolean = false) {
        totalNetworkCalls.incrementAndGet()
        if (isApi) {
            apiCalls.incrementAndGet()
        }
    }

    fun recordAssetLoadAttempt() {
        assetLoadAttempts.incrementAndGet()
    }

    fun recordAssetLoadSuccess() {
        assetLoadSuccesses.incrementAndGet()
    }

    fun recordCacheHit() {
        cacheHits.incrementAndGet()
        Log.d(TAG, "🔄 Cache hit recorded. Total hits: ${cacheHits.get()}")
    }

    fun recordCacheMiss() {
        cacheMisses.incrementAndGet()
        Log.d(TAG, "🔄 Cache miss recorded. Total misses: ${cacheMisses.get()}")
    }

    fun setBundleSize(size: Long) {
        bundleSize = size
        Log.d(TAG, "📦 Bundle size: ${formatSize(size)}")
    }

    fun setServiceWorkerInfo(active: Boolean, controlledPages: Int) {
        serviceWorkerActive = active
        serviceWorkerControlledPageCount = controlledPages
        Log.d(TAG, "👷 Service Worker - active: $active, controlling: $controlledPages pages")
    }

    fun logAllMetrics() {
        val sb = StringBuilder()
        sb.appendLine("📊 PERFORMANCE METRICS 📊")
        sb.appendLine("------------------------")
        sb.appendLine("App Metrics:")
        sb.appendLine("  • App start time: ${appStartCompleteTime}ms")
        sb.appendLine("  • WebView instance time: ${webViewInstanceCreationTime}ms")

        sb.appendLine("\nPage Load Metrics:")
        pageLoadEndTimes.forEach { (url, time) ->
            val fcp = fcpTimes[url] ?: 0
            sb.appendLine("  • URL: $url")
            sb.appendLine("    - Load time: ${time}ms")
            sb.appendLine("    - True load time: ${webViewInstanceCreationTime + time}ms")
            sb.appendLine("    - FCP: ${fcp}ms")
            sb.appendLine("    - True FCP: ${webViewInstanceCreationTime + fcp}ms")
        }

        sb.appendLine("\nNetwork Metrics:")
        sb.appendLine("  • Total network calls: ${totalNetworkCalls.get()}")
        sb.appendLine("  • API calls: ${apiCalls.get()}")
        sb.appendLine("  • Initial page from assets: $initialPageLoadedFromAssets")
        sb.appendLine("  • Service worker active: $serviceWorkerActive")

        sb.appendLine("\nAsset Loading Metrics:")
        val assetSuccessRate = if (assetLoadAttempts.get() > 0) {
            String.format("%.1f%%", assetLoadSuccesses.get() * 100.0 / assetLoadAttempts.get())
        } else "0%"
        sb.appendLine("  • Asset load attempts: ${assetLoadAttempts.get()}")
        sb.appendLine("  • Asset load successes: ${assetLoadSuccesses.get()}")
        sb.appendLine("  • Asset success rate: $assetSuccessRate")

        sb.appendLine("\nCache Metrics:")
        val cacheHitRate = if ((cacheHits.get() + cacheMisses.get()) > 0) {
            String.format("%.1f%%", cacheHits.get() * 100.0 / (cacheHits.get() + cacheMisses.get()))
        } else "0%"
        sb.appendLine("  • Cache hits: ${cacheHits.get()}")
        sb.appendLine("  • Cache misses: ${cacheMisses.get()}")
        sb.appendLine("  • Cache hit rate: $cacheHitRate")

        sb.appendLine("\nResource Metrics:")
        sb.appendLine("  • Bundle size: ${formatSize(bundleSize)}")

        // Use Log.i with the TAG for visibility
        Log.i(TAG, sb.toString())

        // Also use Log.e to ensure it's visible in most log filters
        Log.e("PERFORMANCE_SUMMARY", "Performance metrics summary logged")
    }

    fun cleanup() {
        // Force log metrics
        Log.i(TAG, "⚠️ Cleaning up metrics monitor and generating final report")
        logAllMetrics()
    }

    private fun formatSize(size: Long): String {
        if (size <= 0) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        val digitGroups = (Math.log10(size.toDouble()) / Math.log10(1024.0)).toInt()
        return String.format("%.2f %s", size / Math.pow(1024.0, digitGroups.toDouble()), units[digitGroups])
    }
}