/**
 * measure.js
 *
 * Shared _measure() and _colorFor() logic used by every collector.
 * Injected as a dependency — collectors never call performance.measure() directly.
 *
 * Chrome DevTools Extensibility API rules (Chrome 128+):
 *   - detail must be { devtools: { dataType:'track-entry', ... } }
 *   - custom data goes in properties[] as [key, value] pairs
 *   - start AND end must both be numeric ms timestamps — passing a mark name
 *     string as start causes silent fallback to Timings row (confirmed Chrome 145)
 */

import { TRACK_GROUP, COLOR, PREFIX, THRESHOLD } from './constants.js'

export class Measure {
    constructor() {
        // Rolling window of recent LoAF entries — shared across all collectors
        // so any collector can check loafOverlap without knowing about others.
        this._recentLoafs = []
    }

    /**
     * Record a LoAF entry so overlap detection stays current.
     * Called by RenderCollector whenever a long-animation-frame fires.
     */
    recordLoaf(start, end) {
        this._recentLoafs.push({ start, end })
        if (this._recentLoafs.length > THRESHOLD.LOAF_WINDOW) {
            this._recentLoafs.shift()
        }
    }

    overlapsLoaf(startMs, endMs) {
        return this._recentLoafs.some(
            (loaf) => startMs < loaf.end && endMs > loaf.start
        )
    }

    /**
     * Emit a performance.measure() with Chrome DevTools Extensibility API metadata.
     *
     * @param {string} name      - measure name (catalyst:...)
     * @param {string} startMark - name of the opening performance.mark()
     * @param {number} endTime   - end time in ms (performance.now()-space)
     * @param {object} detail    - arbitrary detail fields added as properties[]
     * @param {string} track     - Chrome DevTools track name (from TRACK constant)
     * @param {string} [color]   - override color; if omitted, derived from name+detail
     */
    emit(name, startMark, endTime, detail = {}, track, color = null) {
        try {
            const startTime = performance.getEntriesByName(startMark, 'mark')[0]?.startTime
            if (startTime == null) {
                console.warn('[CatalystPerf] measure skipped — mark not found:', startMark)
                return
            }
            const resolvedColor = color ?? this._colorFor(name, detail, startTime, endTime)
            const properties = Object.entries(detail)

            performance.measure(name, {
                start: startTime,
                end: endTime,
                detail: {
                    devtools: {
                        dataType:    'track-entry',
                        trackGroup:  TRACK_GROUP,
                        track,
                        color:       resolvedColor,
                        tooltipText: name,
                        properties,
                    }
                }
            })
        } catch (e) {
            console.warn('[CatalystPerf] measure failed:', name, e.message)
        }
    }

    // ─── Color derivation ─────────────────────────────────────────────────────

    _colorFor(name, detail, startTime, endTime) {
        const duration = endTime - startTime

        // LoAF — always error (it's a bad frame by definition)
        if (name.startsWith(PREFIX.LOAF)) return COLOR.ERROR

        // LCP — error if slow
        if (name.startsWith(PREFIX.LCP))
            return detail.renderTime > THRESHOLD.LCP_BAD_MS ? COLOR.ERROR : COLOR.PRIMARY
        if (name.startsWith(PREFIX.FCP)) return COLOR.PRIMARY

        // Navigation session
        if (name.startsWith(PREFIX.SESSION_NAV))
            return duration > THRESHOLD.NAV_SESSION_BAD_MS ? COLOR.ERROR : COLOR.PRIMARY

        // Route transition
        if (name.startsWith(PREFIX.ROUTE_TRANSITION)) return COLOR.SECONDARY

        // Scroll session — error if janky
        if (name.startsWith(PREFIX.SESSION_SCROLL))
            return detail.loafCount > 0 ? COLOR.ERROR : COLOR.PRIMARY

        // Keyboard / viewport — informational
        if (name.startsWith(PREFIX.SESSION_KEYBOARD)) return COLOR.SECONDARY
        if (name.startsWith(PREFIX.VIEWPORT_RESIZE))  return COLOR.SECONDARY

        // Layout shift
        if (name.startsWith(PREFIX.LAYOUT_SHIFT))
            return detail.value > THRESHOLD.CLS_BAD ? COLOR.ERROR : COLOR.TERTIARY

        // Cache spans — color passed explicitly by CacheCollector, this is fallback only
        if (name.startsWith(PREFIX.CACHE + '/')) {
            if (name.includes('/hit|memory|')) return COLOR.PRIMARY
            if (name.includes('/hit|disk|'))   return COLOR.PRIMARY_LIGHT
            if (name.includes('/miss|'))       return COLOR.ERROR
            return COLOR.TERTIARY
        }

        // Bridge calls
        if (name.startsWith(PREFIX.BRIDGE_CALL)) {
            if (detail.timedOut)                              return COLOR.ERROR
            if (duration > THRESHOLD.BRIDGE_SLOW_MS)         return COLOR.ERROR
            return COLOR.SECONDARY
        }

        // Hook spans — error if LoAF burst detected during mount
        if (name.startsWith(PREFIX.HOOK_MOUNT) || name.startsWith(PREFIX.HOOK_LAZY))
            return detail.loafCount > 0 ? COLOR.ERROR : COLOR.SECONDARY

        // Interaction
        if (name.startsWith(PREFIX.INTERACTION))
            return duration > THRESHOLD.INTERACTION_SLOW_MS ? COLOR.ERROR : COLOR.PRIMARY

        // Long press — just informational
        if (name.startsWith(PREFIX.LONG_PRESS)) return COLOR.TERTIARY

        return COLOR.SECONDARY
    }
}
