package io.yourname.androidproject

import android.content.Context
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Simple metrics monitor for WebView-based Android applications.
 * Tracks key performance metrics and logs them on app destroy.
 */
class MetricsMonitor(private val context: Context) {
    private val TAG = "MetricsMonitor"

    // App Startup metrics
    private var appStartTime: Long = SystemClock.elapsedRealtime()
    private var coldStartDuration: Long = 0

    // Page Load metrics
    private val pageLoadTimes = mutableMapOf<String, Long>()
    private var currentPageLoadStartTime: Long = 0
    private var avgPageLoadTime: Long = 0
    private var totalPagesLoaded: Int = 0

    // Frame rate metrics
    private var frameCounter = AtomicInteger(0)
    private var lastFpsCheckTime = SystemClock.elapsedRealtime()
    private var currentFps = 0.0
    private var minFps = Double.MAX_VALUE
    private var maxFps = 0.0
    private var avgFps = 0.0
    private var fpsReadings = 0

    // Memory metrics
    private var initialMemory: Long = getMemoryUsage()
    private var peakMemory: Long = initialMemory
    private var currentMemory: Long = initialMemory

    // Cache metrics
    private var cacheHits = 0
    private var cacheMisses = 0
    private val cachedFiles = mutableSetOf<String>()
    private val filesServedFromCache = mutableListOf<String>()
    private val cacheMissedUrls = mutableListOf<String>()
    private val allNetworkRequests = mutableListOf<String>()
    private val cacheEvaluatedRequests = mutableListOf<String>()

    // Thread metrics
    private var uiBlockingEvents = 0
    private var longTaskThreshold = 16L // ms (1 frame at 60fps)
    private var longTasksDetected = 0

    // Battery impact (simplified)
    private var appRunDuration: Long = 0

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            frameCounter.incrementAndGet()
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    init {
        recordAppStart()
        startFrameMonitoring()
        monitorMemoryPeriodically()
    }

    fun recordAppStart() {
        appStartTime = SystemClock.elapsedRealtime()
    }

    fun markAppStartComplete() {
        coldStartDuration = SystemClock.elapsedRealtime() - appStartTime
        Log.d(TAG, "App cold start completed in: $coldStartDuration ms")
    }

    fun trackPageLoadStart(url: String) {
        currentPageLoadStartTime = SystemClock.elapsedRealtime()
        pageLoadTimes[url] = currentPageLoadStartTime
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📄 PAGE_LOAD_START: $url")
        }
    }

    fun trackPageLoadEnd(url: String) {
        val startTime = pageLoadTimes[url] ?: return
        val loadTime = SystemClock.elapsedRealtime() - startTime

        // Update average
        val totalTime = avgPageLoadTime * totalPagesLoaded + loadTime
        totalPagesLoaded++
        avgPageLoadTime = totalTime / totalPagesLoaded

        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📄 PAGE_LOAD_END: $url in $loadTime ms")
            Log.d(TAG, "📄 PAGE_STATS: Total pages: $totalPagesLoaded, Avg time: $avgPageLoadTime ms")
        }
    }

    fun recordCacheHit(url: String = "") {
        cacheHits++
        if (url.isNotEmpty()) {
            filesServedFromCache.add(url)
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "💾 CACHE_HIT: $url (Total hits: $cacheHits)")
            }
        }
    }

    fun recordCacheMiss(url: String = "") {
        cacheMisses++
        if (url.isNotEmpty()) {
            cacheMissedUrls.add(url)
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "❌ CACHE_MISS: $url (Total misses: $cacheMisses)")
            }
        }
    }

    fun recordCachedFile(url: String) {
        cachedFiles.add(url)
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "💾 FILE_CACHED: $url (Total cached files: ${cachedFiles.size})")
        }
    }

    fun recordNetworkRequest(url: String) {
        if (url.isNotEmpty()) {
            allNetworkRequests.add(url)
        }
    }

    fun recordCacheEvaluation(url: String) {
        if (url.isNotEmpty()) {
            cacheEvaluatedRequests.add(url)
        }
    }

    fun recordUiBlocking() {
        uiBlockingEvents++
    }

    fun recordLongTask() {
        longTasksDetected++
    }

    private fun startFrameMonitoring() {
        Choreographer.getInstance().postFrameCallback(frameCallback)

        // Start a thread to calculate FPS every second
        Thread {
            while (!Thread.interrupted()) {
                try {
                    Thread.sleep(1000)
                    calculateFps()
                } catch (e: InterruptedException) {
                    break
                }
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    private fun calculateFps() {
        val now = SystemClock.elapsedRealtime()
        val frames = frameCounter.getAndSet(0)
        val timeSpan = now - lastFpsCheckTime
        lastFpsCheckTime = now

        if (timeSpan > 0) {
            currentFps = frames * 1000.0 / timeSpan

            // Update min/max/avg
            if (minFps == Double.MAX_VALUE) minFps = currentFps
            minFps = minFps.coerceAtMost(currentFps)
            maxFps = maxFps.coerceAtLeast(currentFps)

            val totalFps = avgFps * fpsReadings + currentFps
            fpsReadings++
            avgFps = totalFps / fpsReadings
        }
    }

    private fun monitorMemoryPeriodically() {
        Thread {
            while (!Thread.interrupted()) {
                try {
                    currentMemory = getMemoryUsage()
                    peakMemory = peakMemory.coerceAtLeast(currentMemory)
                    Thread.sleep(5000) // Check every 5 seconds
                } catch (e: InterruptedException) {
                    break
                }
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    private fun getMemoryUsage(): Long {
        val memoryInfo = Debug.MemoryInfo()
        Debug.getMemoryInfo(memoryInfo)
        return memoryInfo.totalPss.toLong() // in kilobytes
    }

    fun getCacheStats(): String {
        val cacheRate = if ((cacheHits + cacheMisses) > 0)
            (cacheHits * 100 / (cacheHits + cacheMisses)) else 0

        return "Cache: $cacheHits hits, $cacheMisses misses, ${cacheRate}% hit rate, ${cachedFiles.size} files cached"
    }

    fun getFilesServedFromCache(): List<String> {
        return filesServedFromCache.toList()
    }

    fun logAllMetrics() {
        appRunDuration = SystemClock.elapsedRealtime() - appStartTime

        val memoryDelta = currentMemory - initialMemory
        val memoryGrowth = if (initialMemory > 0) (memoryDelta * 100 / initialMemory) else 0

        val cacheRate = if ((cacheHits + cacheMisses) > 0)
            (cacheHits * 100 / (cacheHits + cacheMisses)) else 0

        val sb = StringBuilder()
        sb.appendLine("==================== PERFORMANCE METRICS ====================")
        sb.appendLine("App Run Duration: ${formatDuration(appRunDuration)}")
        sb.appendLine("Cold Start Time: $coldStartDuration ms")
        sb.appendLine("")
        sb.appendLine("PAGE LOADING:")
        sb.appendLine("- Pages Loaded: $totalPagesLoaded")
        sb.appendLine("- Avg Load Time: $avgPageLoadTime ms")
        sb.appendLine("")
        sb.appendLine("RENDERING PERFORMANCE:")
        sb.appendLine("- Current FPS: ${"%.1f".format(currentFps)}")
        sb.appendLine("- Min FPS: ${"%.1f".format(if (minFps == Double.MAX_VALUE) 0.0 else minFps)}")
        sb.appendLine("- Max FPS: ${"%.1f".format(maxFps)}")
        sb.appendLine("- Avg FPS: ${"%.1f".format(avgFps)}")
        sb.appendLine("- UI Blocking Events: $uiBlockingEvents")
        sb.appendLine("- Long Tasks (>16ms): $longTasksDetected")
        sb.appendLine("")
        sb.appendLine("MEMORY USAGE:")
        sb.appendLine("- Initial: ${initialMemory / 1024} MB")
        sb.appendLine("- Current: ${currentMemory / 1024} MB")
        sb.appendLine("- Peak: ${peakMemory / 1024} MB")
        sb.appendLine("- Growth: $memoryGrowth%")
        sb.appendLine("")
        sb.appendLine("CACHE EFFICIENCY:")
        sb.appendLine("- Cache Hits: $cacheHits")
        sb.appendLine("- Cache Misses: $cacheMisses")
        sb.appendLine("- Cache Hit Rate: $cacheRate%")
        sb.appendLine("- Total Network Requests: ${allNetworkRequests.size}")
        sb.appendLine("- Cache Evaluated Requests: ${cacheEvaluatedRequests.size}")
        sb.appendLine("- Not Evaluated for Cache: ${allNetworkRequests.size - cacheEvaluatedRequests.size}")
        sb.appendLine("- Total Files Cached: ${cachedFiles.size}")
        sb.appendLine("- Files Served from Cache: ${filesServedFromCache.size}")
        sb.appendLine("")
        if (filesServedFromCache.isNotEmpty()) {
            sb.appendLine("FILES SERVED FROM CACHE:")
            filesServedFromCache.take(10).forEach { url ->
                sb.appendLine("  ✅ ${url.substringAfterLast("/")}")
            }
            if (filesServedFromCache.size > 10) {
                sb.appendLine("  ... and ${filesServedFromCache.size - 10} more files")
            }
            sb.appendLine("")
        }

        if (cacheMissedUrls.isNotEmpty()) {
            sb.appendLine("CACHE MISSES (URLs that should have been cached):")
            // Group by file extension to make it easier to analyze
            val missedByExtension = cacheMissedUrls.groupBy { url ->
                url.substringAfterLast('.').substringBefore('?').substringBefore('#').lowercase()
            }
            missedByExtension.forEach { (ext, urls) ->
                sb.appendLine("  Extension .$ext: ${urls.size} files")
                urls.take(3).forEach { url ->
                    sb.appendLine("    ❌ ${url.substringAfterLast("/")}")
                }
                if (urls.size > 3) {
                    sb.appendLine("    ... and ${urls.size - 3} more")
                }
            }
            sb.appendLine("")
        }

        // Show requests that were not evaluated for caching
        val notEvaluated = allNetworkRequests.filter { it !in cacheEvaluatedRequests }
        if (notEvaluated.isNotEmpty()) {
            sb.appendLine("REQUESTS NOT EVALUATED FOR CACHE (${notEvaluated.size} total):")
            val groupedNotEvaluated = notEvaluated.groupBy { url ->
                val ext = url.substringAfterLast('.').substringBefore('?').substringBefore('#').lowercase()
                if (ext.length > 10 || !ext.matches(Regex("[a-z0-9]+"))) "other" else ext
            }
            groupedNotEvaluated.forEach { (ext, urls) ->
                sb.appendLine("  .$ext: ${urls.size} files")
                urls.take(2).forEach { url ->
                    sb.appendLine("    • ${url.substringAfterLast("/").take(50)}")
                }
                if (urls.size > 2) {
                    sb.appendLine("    ... and ${urls.size - 2} more")
                }
            }
            sb.appendLine("")
        }
        sb.appendLine("==============================================================")

        Log.i(TAG, sb.toString())
    }

    private fun formatDuration(millis: Long): String {
        return String.format("%02d:%02d:%02d",
            TimeUnit.MILLISECONDS.toHours(millis),
            TimeUnit.MILLISECONDS.toMinutes(millis) % TimeUnit.HOURS.toMinutes(1),
            TimeUnit.MILLISECONDS.toSeconds(millis) % TimeUnit.MINUTES.toSeconds(1))
    }

    fun cleanup() {
        // Remove frame callback
        Choreographer.getInstance().removeFrameCallback(frameCallback)
    }

    companion object {
        private var instance: MetricsMonitor? = null

        fun getInstance(context: Context): MetricsMonitor {
            return instance ?: synchronized(this) {
                instance ?: MetricsMonitor(context.applicationContext)
                    .also { instance = it }
            }
        }
    }
}