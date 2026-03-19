package io.yourname.androidproject.utils

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * PerfEventBuffer — native ring buffer for Catalyst profiler events.
 *
 * Collects all events from onCreate (boot timing, cache, API calls) and flushes
 * them as a single JSON array to the web layer after onPageFinished.
 *
 * Design:
 *   - add() is safe from any thread (ConcurrentLinkedQueue)
 *   - scheduleFlush() called from onPageFinished — posts to main thread after 250ms
 *     so the JS environment is ready to receive events
 *   - flush() serialises all events to JSON array, calls window.__catalystPerfBatch()
 *   - CacheSummarizer: running tally of hit/miss/fetch + top-5 min-heap for InsightsCollector
 *   - Max ring buffer size: 500 events (oldest dropped if exceeded)
 *
 * API call timing:
 *   - bridgeCallReceived(callId, method) → stamps t0, stores in pendingCalls map
 *   - bridgeCallDispatched(callId) → stamps t1, computes durationMs, adds api-call event to buffer
 */
object PerfEventBuffer {

    private const val TAG = "PerfEventBuffer"
    private const val MAX_BUFFER_SIZE = 500
    private const val FLUSH_DELAY_MS = 250L
    private const val PERIODIC_FLUSH_INTERVAL_MS = 4000L

    private val buffer = ConcurrentLinkedQueue<JSONObject>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val flushed = AtomicBoolean(false)

    // Periodic flush state
    @Volatile private var periodicWebView: WebView? = null
    private var lastFlushedSize = 0
    private val periodicRunnable: Runnable = object : Runnable {
        override fun run() {
            val wv = periodicWebView ?: return
            val currentSize = buffer.size
            if (currentSize > lastFlushedSize) {
                android.util.Log.d(TAG, "[PerfBuffer] periodicFlush() — $currentSize events since last flush")
                flushIncremental(wv)
            }
            mainHandler.postDelayed(this, PERIODIC_FLUSH_INTERVAL_MS)
        }
    }

    // Pending API call timing: callId → t0 nativeMs + method
    private val pendingCalls = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, String>>()

    // ─── CacheSummarizer ─────────────────────────────────────────────────────

    private var cacheHits   = 0
    private var cacheMisses = 0
    private var cacheFetches = 0
    private var cacheTotalMs = 0L
    // top-5 slowest: list of Pair(durationMs, filename)
    private val cacheTopSlow = java.util.PriorityQueue<Pair<Long, String>>(
        6, compareBy { it.first }
    )

    private fun updateCacheSummary(type: String, durationMs: Long, url: String) {
        val filename = try {
            val path = java.net.URI(url).path
            path.split("/").filter { it.isNotEmpty() }.lastOrNull()?.take(40) ?: url.take(40)
        } catch (e: Exception) { url.take(40) }

        when (type) {
            "cache-hit-memory", "cache-hit-disk" -> cacheHits++
            "cache-miss-fetch"                   -> cacheMisses++
            "network-fetch-complete"             -> {
                cacheFetches++
                cacheTotalMs += durationMs
                cacheTopSlow.add(Pair(durationMs, filename))
                if (cacheTopSlow.size > 5) cacheTopSlow.poll() // remove smallest
            }
        }
    }

    private fun buildCacheSummaryEvent(): JSONObject? {
        val total = cacheHits + cacheMisses
        if (total == 0) return null
        val hitRate = if (total > 0) (cacheHits * 100.0 / total) else 0.0
        val avgFetchMs = if (cacheFetches > 0) cacheTotalMs / cacheFetches else 0L
        val topSlow = JSONArray()
        cacheTopSlow.sortedByDescending { it.first }.forEach { (ms, name) ->
            topSlow.put(JSONObject().apply {
                put("filename", name)
                put("durationMs", ms)
            })
        }
        return JSONObject().apply {
            put("type", "cache-summary")
            put("hits", cacheHits)
            put("misses", cacheMisses)
            put("fetches", cacheFetches)
            put("total", total)
            put("hitRatePct", Math.round(hitRate * 10) / 10.0)
            put("avgFetchMs", avgFetchMs)
            put("topSlowest", topSlow)
            put("nativeTime", SystemClock.elapsedRealtime())
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /** Add a perf event to the buffer. Safe from any thread. */
    fun add(event: JSONObject) {
        if (buffer.size >= MAX_BUFFER_SIZE) {
            buffer.poll() // drop oldest
        }
        // Update cache summary tally
        val type = event.optString("type")
        if (type.startsWith("cache-") || type == "network-fetch-complete") {
            updateCacheSummary(type, event.optLong("durationMs", 0), event.optString("url"))
        }
        buffer.add(event)
        android.util.Log.d(TAG, "[PerfBuffer] add() type=$type bufferSize=${buffer.size}")
    }

    /**
     * Record start of an @JavascriptInterface bridge call.
     * Call this immediately when the method is invoked on the JavascriptInterface.
     */
    fun bridgeCallReceived(callId: String, method: String) {
        pendingCalls[callId] = Pair(SystemClock.elapsedRealtime(), method)
    }

    /**
     * Record end of a bridge call — when notifyWeb/callback fires back to JS.
     * Computes durationMs and adds an api-call event to the buffer.
     */
    fun bridgeCallDispatched(callId: String) {
        val pending = pendingCalls.remove(callId) ?: return
        val (t0, method) = pending
        val t1 = SystemClock.elapsedRealtime()
        val durationMs = t1 - t0
        add(JSONObject().apply {
            put("type", "api-call")
            put("callId", callId)
            put("method", method)
            put("nativeStartMs", t0)
            put("nativeEndMs", t1)
            put("durationMs", durationMs)
            put("thread", Thread.currentThread().name)
        })
    }

    /**
     * Schedule a flush after onPageFinished (initial/full page load).
     * Also starts the periodic flush loop for subsequent SPA navigations.
     */
    fun scheduleFlush(webView: WebView) {
        if (flushed.getAndSet(true)) {
            android.util.Log.d(TAG, "[PerfBuffer] scheduleFlush() skipped — already flushed")
            return
        }
        android.util.Log.d(TAG, "[PerfBuffer] scheduleFlush() scheduled in ${FLUSH_DELAY_MS}ms, bufferSize=${buffer.size}")
        mainHandler.postDelayed({
            flush(webView)
            // Start periodic flush loop for SPA navigations after initial load
            startPeriodicFlush(webView)
        }, FLUSH_DELAY_MS)
    }

    /**
     * Flush any pending events immediately (e.g. before a full URL navigation).
     * Does NOT reset the buffer — only drains buffered events up to this point.
     */
    fun flushNow(webView: WebView) {
        mainHandler.post { flushIncremental(webView) }
    }

    /**
     * Start periodic flush loop — fires every 4s and flushes only if new events exist.
     * Call after onPageFinished so the JS receiver is registered.
     */
    fun startPeriodicFlush(webView: WebView) {
        mainHandler.removeCallbacks(periodicRunnable)
        periodicWebView = webView
        lastFlushedSize = 0
        mainHandler.postDelayed(periodicRunnable, PERIODIC_FLUSH_INTERVAL_MS)
        android.util.Log.d(TAG, "[PerfBuffer] startPeriodicFlush() — interval=${PERIODIC_FLUSH_INTERVAL_MS}ms")
    }

    /** Stop periodic flush (call on destroy / loadUrl reset). */
    fun stopPeriodicFlush() {
        mainHandler.removeCallbacks(periodicRunnable)
        periodicWebView = null
    }

    /**
     * Reset the buffer for the next page load.
     * Call this from loadUrl so boot timing events for the new page are captured.
     */
    fun reset() {
        stopPeriodicFlush()
        buffer.clear()
        pendingCalls.clear()
        flushed.set(false)
        lastFlushedSize = 0
        cacheHits = 0
        cacheMisses = 0
        cacheFetches = 0
        cacheTotalMs = 0L
        cacheTopSlow.clear()
    }

    // ─── Flush ───────────────────────────────────────────────────────────────

    /**
     * Incremental flush — drains buffered events since last flush, no cache-summary appended.
     * Used by periodic flush and flushNow(). Must run on main thread.
     */
    private fun flushIncremental(webView: WebView) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { flushIncremental(webView) }
            return
        }
        val events = JSONArray()
        while (buffer.isNotEmpty()) {
            buffer.poll()?.let { events.put(it) }
        }
        lastFlushedSize = 0 // buffer was drained

        android.util.Log.d(TAG, "[PerfBuffer] flushIncremental() — ${events.length()} events")
        if (events.length() == 0) return

        try {
            val jsonStr = events.toString()
                .replace("\\", "\\\\")
                .replace("'", "\\'")
            webView.evaluateJavascript(
                "window.__catalystPerfBatch && window.__catalystPerfBatch('$jsonStr')",
                null
            )
        } catch (e: Exception) {
            android.util.Log.e(TAG, "flushIncremental failed: ${e.message}")
        }
    }

    private fun flush(webView: WebView) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { flush(webView) }
            return
        }
        val events = JSONArray()
        while (buffer.isNotEmpty()) {
            buffer.poll()?.let { events.put(it) }
        }
        // Append cache summary as final event
        buildCacheSummaryEvent()?.let { events.put(it) }

        android.util.Log.d(TAG, "[PerfBuffer] flush() totalEvents=${events.length()} (hits=$cacheHits misses=$cacheMisses fetches=$cacheFetches)")

        if (events.length() == 0) {
            android.util.Log.d(TAG, "[PerfBuffer] flush() — nothing to flush, skipping")
            return
        }

        try {
            val jsonStr = events.toString()
                .replace("\\", "\\\\")
                .replace("'", "\\'")
            android.util.Log.d(TAG, "[PerfBuffer] flush() calling __catalystPerfBatch with ${events.length()} events")
            webView.evaluateJavascript(
                "window.__catalystPerfBatch && window.__catalystPerfBatch('$jsonStr')",
                null
            )
        } catch (e: Exception) {
            android.util.Log.e(TAG, "flush failed: ${e.message}")
        }
    }
}
