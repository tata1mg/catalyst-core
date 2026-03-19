/**
 * RenderCollector.js
 *
 * Instruments: bugs #1, #6, #10, #14, #15, #16
 *   #1  page slowness / cache miss     → LoAF during navigation session = render blocked by loading
 *   #6  blank screens                  → LoAF blocks first render; LCP may never fire
 *   #10 footer flash on Drug/OTC       → layout-shift fires just after navigation session closes
 *   #14 transitions not soft           → layout-shift during nav = skeleton→content swap too abrupt
 *   #15 quantity selector slow         → LoAF burst in the 2s after interaction (lazy chunk blocks)
 *   #16 prescription screen touch lag  → same LoAF burst pattern after tap
 *
 * Spans emitted:
 *   catalyst:loaf|<ms>ms           — long animation frame (Track: Render)
 *                                    detail: blockingDuration, scriptCount, sessionContext
 *   catalyst:layout-shift|<value>  — unexpected layout shift (Track: Render)
 *                                    detail: value, sessionContext
 *   catalyst:fps-drop|<fps>fps-min|<ms>ms — native fps-drop episode (Track: Render)
 *                                    detail: minFps, avgFps, durationMs, sessionContext
 *                                    closes on recovery >55fps OR after 10s max
 *   catalyst:long-task|<ms>ms      — native long task > 16ms (Track: Render)
 *   catalyst:mem/jvm|<MB>MB     — JVM heap PSS — Kotlin/Java objects (Track: Render, blue)
 *   catalyst:mem/native|<MB>MB  — native heap PSS — V8 + Blink + JNI, WebView proxy (Track: Render, orange)
 *   catalyst:mem/total|<MB>MB   — total process PSS — what Android OOM killer sees (Track: Render, purple→red)
 *
 * Notifies:
 *   ScrollCollector.onLoaf()       — so scroll session can increment its loafCount
 *   HookCollector.onLoaf()         — so hook mount sessions can detect LoAF bursts
 */

import { TRACK, PREFIX } from '../core/constants.js'

export class RenderCollector {
    constructor(measure, getSessionContext, nativeToWeb) {
        this._measure           = measure
        // getSessionContext() returns 'navigation'|'scroll'|'keyboard'|'none'
        // provided by index.js so RenderCollector doesn't import other collectors
        this._getSessionContext = getSessionContext
        this._nativeToWeb       = nativeToWeb ?? ((t) => t)
        this._loafListeners     = []   // [fn] called on every LoAF
        this._getInteraction    = null // set by index.js after construction
    }

    /** Called by index.js to wire up interaction session context. */
    setInteractionSource(fn) {
        this._getInteraction = fn
    }

    /** Called by index.js to wire up insights notifications. */
    setInsightsSource(fn) {
        this._notifyInsights = fn
    }

    // Allow other collectors to subscribe to LoAF events
    addLoafListener(fn) {
        this._loafListeners.push(fn)
    }

    init() {
        this._observeLoAF()
        this._observeLayoutShift()
    }

    // ─── Native MetricsMonitor events ────────────────────────────────────────

    onNativeEvent(event) {
        const t = this._nativeToWeb(event.nativeTime)

        switch (event.type) {
            case 'fps-drop-episode': {
                const start = this._nativeToWeb(event.startNativeTime)
                const end   = this._nativeToWeb(event.endNativeTime)
                const markName = `${PREFIX.FPS_DROP}:${Math.round(start)}`
                performance.mark(markName, { startTime: start })

                const sessionId = this._getInteraction?.()?.activeSessionId ?? null
                if (sessionId) this._getInteraction?.()?.onFpsDrop()

                this._measure.emit(
                    `${PREFIX.FPS_DROP}|${event.minFps.toFixed(1)}fps-min|${Math.round(event.durationMs)}ms`,
                    markName,
                    end,
                    {
                        minFps:         event.minFps,
                        avgFps:         event.avgFps,
                        durationMs:     event.durationMs,
                        sessionContext: this._getSessionContext(),
                        sessionId,
                        thread:         event.thread ?? null,
                        simulatorValid: false,
                    },
                    TRACK.RENDER,
                    event.minFps < 30 ? 'error' : 'primary'
                )
                break
            }
            case 'long-task': {
                const markName = `${PREFIX.LONG_TASK}:${Math.round(t)}`
                performance.mark(markName, { startTime: t })
                this._measure.emit(
                    `${PREFIX.LONG_TASK}|${event.durationMs}ms`,
                    markName,
                    t + event.durationMs,
                    {
                        durationMs:     event.durationMs,
                        sessionContext: this._getSessionContext(),
                        thread:         event.thread ?? null,
                        simulatorValid: true,
                    },
                    TRACK.RENDER,
                    event.durationMs > 100 ? 'error' : 'tertiary'
                )
                break
            }
            case 'memory-snapshot': {
                // Three point-in-time spans emitted at the same timestamp so they
                // stack visually. Each has a distinct color so the breakdown is
                // immediately readable without opening the tooltip.
                // 1. JVM heap — your Kotlin/Java objects (blue = familiar "your code")
                const jvmMark = `catalyst:mem/jvm:${Math.round(t)}`
                performance.mark(jvmMark, { startTime: t })
                this._measure.emit(
                    `catalyst:mem/jvm|${event.jvmMb.toFixed(1)}MB`,
                    jvmMark,
                    t + 1,
                    {
                        what:           'Kotlin/Java heap — memory used by your app code, models, and data structures',
                        jvmMb:          event.jvmMb,
                        peakMb:         event.peakMb,
                        thread:         event.thread ?? null,
                        simulatorValid: false,
                        ...(event.coldStartMs != null ? { 'coldStart.ms': event.coldStartMs } : {}),
                    },
                    TRACK.RENDER,
                    'primary'   // blue — your code
                )

                // 2. WebView heap — V8 + Blink + JNI (orange = watch this)
                const webviewMark = `catalyst:mem/webview:${Math.round(t)}`
                performance.mark(webviewMark, { startTime: t })
                this._measure.emit(
                    `catalyst:mem/webview|${event.webviewMb.toFixed(1)}MB`,
                    webviewMark,
                    t + 1,
                    {
                        what:           'WebView engine heap — V8 JS engine + Blink renderer + JNI bridge; healthy idle is 80-120MB, growth = leak signal',
                        webviewMb:      event.webviewMb,
                        otherMb:        event.otherMb,
                        peakMb:         event.peakMb,
                        thread:         event.thread ?? null,
                        simulatorValid: false,
                        ...(event.coldStartMs != null ? { 'coldStart.ms': event.coldStartMs } : {}),
                    },
                    TRACK.RENDER,
                    'tertiary-dark'  // orange — WebView/native territory
                )

                // 3. Total PSS — what the Android OOM killer acts on (purple → red if high)
                const totalMark = `catalyst:mem/total:${Math.round(t)}`
                performance.mark(totalMark, { startTime: t })
                this._measure.emit(
                    `catalyst:mem/total|${event.totalMb.toFixed(1)}MB`,
                    totalMark,
                    t + 1,
                    {
                        what:           'Total process PSS — full memory footprint seen by Android OOM killer; >400MB = OOM risk',
                        totalMb:        event.totalMb,
                        jvmMb:          event.jvmMb,
                        webviewMb:      event.webviewMb,
                        otherMb:        event.otherMb,
                        peakMb:         event.peakMb,
                        thread:         event.thread ?? null,
                        simulatorValid: false,
                        ...(event.coldStartMs != null ? { 'coldStart.ms': event.coldStartMs } : {}),
                    },
                    TRACK.RENDER,
                    event.totalMb > 400 ? 'error' : 'secondary'  // purple normally, red if OOM risk
                )

                // Feed insights off webviewMb — more meaningful than total for leak detection
                // (webviewMb growth = V8/Blink/JNI leak; total growth can be normal app data)
                this._notifyInsights?.({ currentMb: event.webviewMb })
                break
            }
        }
    }

    // ─── Long Animation Frames ────────────────────────────────────────────────

    _observeLoAF() {
        if (!PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return

        const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const start   = entry.startTime
                const end     = start + entry.duration
                const context = this._getSessionContext()

                // Register with shared Measure so all collectors get overlap detection
                this._measure.recordLoaf(start, end)

                // Notify subscribers (ScrollCollector, HookCollector)
                this._loafListeners.forEach((fn) => fn(start, end))

                const markName = `${PREFIX.LOAF}:${Math.round(start)}`
                performance.mark(markName, { startTime: start })
                this._measure.emit(
                    `${PREFIX.LOAF}|${Math.round(entry.duration)}ms`,
                    markName,
                    end,
                    {
                        blockingDuration: entry.blockingDuration,
                        scriptCount:      entry.scripts?.length ?? 0,
                        sessionContext:   context,
                        simulatorValid:   false,
                    },
                    TRACK.RENDER
                )
            }
        })
        obs.observe({ type: 'long-animation-frame', buffered: true })
    }

    // ─── Layout shift ─────────────────────────────────────────────────────────

    _observeLayoutShift() {
        if (!PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) return

        const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.hadRecentInput) continue  // user-initiated shift, ignore

                const context  = this._getSessionContext()
                const markName = `catalyst:cls:${Math.round(entry.startTime)}`
                performance.mark(markName, { startTime: entry.startTime })
                if (entry.value > 0.1) {
                    this._notifyInsights?.({ value: entry.value, sessionContext: context })
                }

                this._measure.emit(
                    `${PREFIX.LAYOUT_SHIFT}|${entry.value.toFixed(4)}`,
                    markName,
                    entry.startTime + 1,  // point-in-time event, minimal duration
                    {
                        value:          entry.value,
                        sessionContext: context,
                        simulatorValid: false,
                    },
                    TRACK.RENDER
                )
            }
        })
        obs.observe({ type: 'layout-shift', buffered: true })
    }
}
