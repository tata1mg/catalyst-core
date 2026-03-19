/**
 * CacheCollector.js
 *
 * Instruments: bugs #1, #2, #10
 *   #1  page slowness OTC pages     → cache miss → slow fetch → resource blocks render
 *   #2  back-forward reloads screen → back navigation triggers a burst of cache misses
 *   #10 footer flash on Drug/OTC    → cache miss for footer chunk → layout shift after load
 *
 * Native events received in two modes:
 *
 * 1. Live (legacy path — only used if buffer disabled):
 *   cache-hit-memory / cache-hit-disk / cache-miss-fetch / network-fetch-complete
 *   → Each emits immediately to Catalyst > Cache track via onNativeEvent()
 *
 * 2. Batched (primary path via __catalystPerfBatch drain in index.js):
 *   Same event types arrive as part of the native buffer flush after onPageFinished.
 *   JS drains via requestIdleCallback → onBatchEvent() → emits spans on Catalyst > Cache > Detail
 *
 *   cache-summary { hits, misses, fetches, total, hitRatePct, avgFetchMs, topSlowest[] }
 *   → One summary span emitted on main Catalyst > Cache track for InsightsCollector
 *
 * Spans emitted:
 *   Catalyst > Cache > Detail  individual spans (one per file) during idle drain
 *   Catalyst > Cache           summary span (hit rate, avg fetch, top slowest)
 *
 * Reading the track:
 *   Blue        = cache HIT memory — fastest path
 *   Blue-light  = cache HIT disk   — good, slightly slower
 *   Red         = cache MISS       — matched pattern but not cached
 *   Yellow/Orange = network fetch  — orange if slow >300ms
 */

import { TRACK, PREFIX, COLOR, THRESHOLD } from '../core/constants.js'

const TRACK_CACHE_DETAIL = 'Cache > Detail'

export class CacheCollector {
    constructor(measure, nativeToWeb) {
        this._measure         = measure
        this._nativeToWeb     = nativeToWeb
        this._notifyInsights  = null  // set by index.js after construction
    }

    /** Called by index.js to wire up insights notifications for cache-summary. */
    setInsightsSource(fn) {
        this._notifyInsights = fn
    }

    init() {
        // No web-side observers — all events come from native
    }

    // ── Live path (individual events routed from index.js) ──────────────────

    onNativeEvent(event) {
        const { type } = event
        if (!type?.startsWith('cache-') && type !== 'network-fetch-complete') return
        this._emitCacheSpan(event, TRACK.CACHE)
    }

    // ── Batch path (native buffer flush) ────────────────────────────────────

    onBatchEvent(event) {
        const { type } = event
        if (type === 'cache-summary') {
            this._emitSummarySpan(event)
            return
        }
        if (!type?.startsWith('cache-') && type !== 'network-fetch-complete') return
        // Individual cache spans go on the Detail sub-track
        this._emitCacheSpan(event, TRACK_CACHE_DETAIL)
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    _emitCacheSpan(event, track) {
        const { type, url, durationMs, nativeStartMs, resourceType, thread, statusCode } = event

        const resType   = resourceType ?? 'other'
        const filename  = this._filename(url)

        const endTime   = nativeStartMs != null
            ? this._nativeToWeb(nativeStartMs) + (durationMs ?? 0)
            : performance.now()
        const startTime = endTime - (durationMs ?? 0)

        let measureName, color, detail

        const interceptThread = event.interceptThread ?? null
        const emitThread      = event.emitThread ?? null

        if (type === 'cache-hit-memory') {
            measureName = `${PREFIX.CACHE}/hit|memory|${resType}|${filename}`
            color       = COLOR.PRIMARY
            detail      = { url, source: 'memory', resourceType: resType, durationMs, thread: thread ?? null, interceptThread, emitThread, simulatorValid: false }

        } else if (type === 'cache-hit-disk') {
            measureName = `${PREFIX.CACHE}/hit|disk|${resType}|${filename}`
            color       = COLOR.PRIMARY_LIGHT
            detail      = { url, source: 'disk', resourceType: resType, durationMs, thread: thread ?? null, interceptThread, emitThread, simulatorValid: false }

        } else if (type === 'cache-miss-fetch') {
            measureName = `${PREFIX.CACHE}/miss|${resType}|${filename}`
            color       = COLOR.ERROR
            detail      = { url, resourceType: resType, durationMs, thread: thread ?? null, interceptThread, emitThread, simulatorValid: false }

        } else if (type === 'network-fetch-complete') {
            const slow  = (durationMs ?? 0) > THRESHOLD.FETCH_SLOW_MS
            measureName = `${PREFIX.CACHE}/fetch|${resType}|${filename}`
            color       = slow ? COLOR.TERTIARY_DARK : COLOR.TERTIARY
            detail      = { url, resourceType: resType, durationMs, statusCode: statusCode ?? null, thread: thread ?? null, emitThread, slow, simulatorValid: false }

        } else {
            return
        }

        const startMark = `${measureName}:start:${Math.round(startTime)}`
        performance.mark(startMark, { startTime })
        this._measure.emit(measureName, startMark, endTime, detail, track, color)
    }

    _emitSummarySpan(event) {
        const { hits, misses, fetches, total, hitRatePct, avgFetchMs, topSlowest, nativeTime } = event
        if (total === 0) return

        // Place summary span at current time (post-load, idle phase)
        const startTime = this._nativeToWeb(nativeTime ?? 0) || performance.now()
        const endTime   = startTime + 1  // point span

        const color = hitRatePct >= 80 ? COLOR.PRIMARY_DARK
            : hitRatePct >= 50 ? COLOR.SECONDARY
            : COLOR.ERROR

        const topNames = Array.isArray(topSlowest)
            ? topSlowest.map(e => `${e.filename}(${e.durationMs}ms)`).join(', ')
            : ''

        const measureName = `${PREFIX.CACHE}/summary`
        const startMark   = `${measureName}:start:${Math.round(startTime)}`
        performance.mark(startMark, { startTime })
        this._measure.emit(
            measureName,
            startMark,
            endTime,
            { hits, misses, fetches, total, hitRatePct, avgFetchMs, topSlowest: topNames, simulatorValid: false },
            TRACK.CACHE,
            color
        )

        // Notify InsightsCollector so it can flag low hit rates
        this._notifyInsights?.({ hitRatePct, total, avgFetchMs })
    }

    _filename(url) {
        try {
            const path = new URL(url).pathname
            const name = path.split('/').filter(Boolean).pop() ?? path
            return name.slice(0, 40)
        } catch {
            return String(url).slice(0, 40)
        }
    }
}
