package com.example.androidProject

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
    }

    fun trackPageLoadEnd(url: String) {
        val startTime = pageLoadTimes[url] ?: return
        val loadTime = SystemClock.elapsedRealtime() - startTime

        // Update average
        val totalTime = avgPageLoadTime * totalPagesLoaded + loadTime
        totalPagesLoaded++
        avgPageLoadTime = totalTime / totalPagesLoaded

        Log.d(TAG, "Page loaded: $url in $loadTime ms")
    }

    fun recordCacheHit() {
        cacheHits++
    }

    fun recordCacheMiss() {
        cacheMisses++
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
        sb.appendLine("- Min FPS: ${"%.1f".format(minFps)}")
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
