package io.yourname.androidproject.utils

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import io.yourname.androidproject.BuildConfig
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
    private const val FLUSH_RETRY_DELAY_MS = 250L
    private const val MAX_FLUSH_RETRIES = 5
    private const val PERIODIC_FLUSH_INTERVAL_MS = 4000L

    private val buffer = ConcurrentLinkedQueue<JSONObject>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val flushed = AtomicBoolean(false)
    @Volatile private var profilerEnabled = false
    private val deliveryState = PerfDeliveryState<JSONArray>()

    // Periodic flush state
    @Volatile private var periodicWebView: WebView? = null
    private var lastFlushedSize = 0
    private val periodicRunnable: Runnable = object : Runnable {
        override fun run() {
            if (!isEnabled()) return
            val wv = periodicWebView ?: return
            val pendingBatch = deliveryState.current()
            if (pendingBatch != null) {
                deliver(wv, pendingBatch)
            } else if (buffer.size > lastFlushedSize) {
                val currentSize = buffer.size
                android.util.Log.d(TAG, "[PerfBuffer] periodicFlush() — $currentSize events since last flush")
                beginFlush(wv, includeCacheSummary = false)
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

    fun configure(enabled: Boolean) {
        profilerEnabled = BuildConfig.DEBUG && enabled
        if (!profilerEnabled) reset()
    }

    fun isEnabled(): Boolean = profilerEnabled

    /** Add a perf event to the buffer. Safe from any thread. */
    fun add(event: JSONObject) {
        if (!isEnabled()) return
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
        if (!isEnabled()) return
        pendingCalls[callId] = Pair(SystemClock.elapsedRealtime(), method)
    }

    /**
     * Record the end of immediate native bridge-handler work and add an api-call event.
     */
    fun bridgeCallDispatched(callId: String) {
        if (!isEnabled()) return
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
        if (!isEnabled()) return
        if (flushed.getAndSet(true)) {
            android.util.Log.d(TAG, "[PerfBuffer] scheduleFlush() skipped — already flushed")
            return
        }
        android.util.Log.d(TAG, "[PerfBuffer] scheduleFlush() scheduled in ${FLUSH_DELAY_MS}ms, bufferSize=${buffer.size}")
        mainHandler.postDelayed({
            beginFlush(webView, includeCacheSummary = true)
            // Start periodic flush loop for SPA navigations after initial load
            startPeriodicFlush(webView)
        }, FLUSH_DELAY_MS)
    }

    /**
     * Flush any pending events immediately (e.g. before a full URL navigation).
     * Does NOT reset the buffer — only drains buffered events up to this point.
     */
    fun flushNow(webView: WebView) {
        if (!isEnabled()) return
        mainHandler.post { beginFlush(webView, includeCacheSummary = false) }
    }

    /**
     * Start periodic flush loop — fires every 4s and flushes only if new events exist.
     * Call after onPageFinished so the JS receiver is registered.
     */
    fun startPeriodicFlush(webView: WebView) {
        if (!isEnabled()) return
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
        deliveryState.reset()
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

    /** Moves the current queue into an immutable in-flight batch until JS acknowledges it. */
    private fun beginFlush(webView: WebView, includeCacheSummary: Boolean) {
        if (!isEnabled()) return
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { beginFlush(webView, includeCacheSummary) }
            return
        }
        if (deliveryState.hasInFlight()) return
        val events = JSONArray()
        while (buffer.isNotEmpty()) {
            buffer.poll()?.let { events.put(it) }
        }
        if (includeCacheSummary) buildCacheSummaryEvent()?.let { events.put(it) }
        if (events.length() == 0) return

        val batch = deliveryState.begin(events) ?: return
        deliver(webView, batch)
    }

    private fun deliver(webView: WebView, batch: PerfDeliveryState.Batch<JSONArray>) {
        if (!isEnabled() || !deliveryState.isCurrent(batch)) return
        try {
            val json = batch.payload.toString().replace("\\", "\\\\").replace("'", "\\'")
            val batchId = JSONObject.quote(batch.id)
            webView.evaluateJavascript(
                "window.__catalystPerfBatch ? window.__catalystPerfBatch($batchId, '$json') : false",
            ) { result ->
                if (result == "true") acknowledge(batch) else retry(webView, batch)
            }
        } catch (_: Exception) {
            retry(webView, batch)
        }
    }

    private fun acknowledge(batch: PerfDeliveryState.Batch<JSONArray>) {
        if (deliveryState.acknowledge(batch)) {
            lastFlushedSize = 0
        }
    }

    private fun retry(webView: WebView, batch: PerfDeliveryState.Batch<JSONArray>) {
        val retry = deliveryState.retry(batch, MAX_FLUSH_RETRIES)
        if (retry == null) {
            android.util.Log.w(TAG, "[PerfBuffer] batch ${batch.id} was not acknowledged; retaining until reset")
            return
        }
        mainHandler.postDelayed({ deliver(webView, retry) }, FLUSH_RETRY_DELAY_MS)
    }
}
