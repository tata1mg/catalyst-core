/**
 * ScrollCollector.js
 *
 * Instruments: bugs #3, #13
 *   #3  keyboard sticky scroll bug   → scroll fires during keyboard session → sticky recalc → layout thrash
 *   #13 cart computation jank        → fps-drop-episode during scroll → scroll session marked janky
 *
 * Spans emitted:
 *   catalyst:session/scroll — scroll-start → scroll-end (Track: Input, shared with keyboard)
 *                             detail: frameDropCount, minFps, janky, scrollDuration
 *
 * Native events consumed (via index.js _routeNativeEvent):
 *   scroll-start  { nativeTime }   — GestureDetector first onScroll() in CustomWebview.kt
 *   scroll-end    { nativeTime }   — GestureDetector ACTION_UP / ACTION_CANCEL
 *
 * fps-drop-episode routed here (Option B) when scroll session is open:
 *   index.js checks this._scroll._session.isOpen before calling onFpsDrop(event)
 */

import { TRACK, PREFIX, THRESHOLD } from '../core/constants.js'
import { Session } from '../core/session.js'

export class ScrollCollector {
    constructor(measure, nativeToWeb) {
        this._measure      = measure
        this._nativeToWeb  = nativeToWeb
        this._session      = new Session(PREFIX.SESSION_SCROLL, measure, TRACK.INPUT)
        this._insightsCb   = null  // set by index.js via setInsightsSource
        this._frameDropCount = 0
        this._minFps         = 60
    }

    init() {
        // No DOM listener — scroll events come from native GestureDetector
    }

    setInsightsSource(cb) {
        this._insightsCb = cb
    }

    // Called by RenderCollector when a LoAF fires (shared notification, kept for compat)
    onLoaf() {
        if (this._session.isOpen) {
            this._session.increment('loafCount')
        }
    }

    // ─── Native event handlers ────────────────────────────────────────────────

    onScrollStart(event) {
        if (this._session.isOpen) return  // already tracking, ignore duplicate start
        const webNow = this._nativeToWeb(event.nativeTime)
        this._frameDropCount = 0
        this._minFps         = 60
        this._session.open({ loafCount: 0 }, webNow)
    }

    onScrollEnd(event) {
        if (!this._session.isOpen) return
        const webNow     = this._nativeToWeb(event.nativeTime)
        const loafCount  = this._session.get('loafCount') ?? 0
        const janky      = this._frameDropCount > 0 || this._minFps < 55

        this._session.close({
            loafCount,
            frameDropCount: this._frameDropCount,
            minFps:         this._minFps,
            janky,
            simulatorValid: false,
        }, webNow)

        if (janky && this._insightsCb) {
            this._insightsCb({ minFps: this._minFps, frameDropCount: this._frameDropCount })
        }

        this._frameDropCount = 0
        this._minFps         = 60
    }

    // ─── fps-drop-episode correlation (Option B) ──────────────────────────────
    // Called from index.js _routeNativeEvent when scroll session is open.

    onFpsDrop(event) {
        this._frameDropCount++
        if (event.minFps != null && event.minFps < this._minFps) {
            this._minFps = event.minFps
        }
    }
}
