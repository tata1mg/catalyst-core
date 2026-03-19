/**
 * perf/index.js — WebPerfCollector
 *
 * Thin orchestrator. Responsibilities:
 *   1. Create all collectors with shared dependencies injected
 *   2. Route native events to the correct collector
 *   3. Wire cross-collector notifications (LoAF → Scroll, Keyboard → Scroll,
 *      Bridge/Render → Interaction session, all events → Insights)
 *   4. Expose WebPerfCollector.init(bridge) — called from WebBridge.init()
 *   5. Drain native batch buffer via __catalystPerfBatch + requestIdleCallback
 *
 * No instrumentation logic lives here. All span logic is in collectors/.
 *
 * Native event routing (live path — __catalystPerfEvent):
 *   keyboard-show / keyboard-hide       → KeyboardCollector
 *   bridge-call-start / bridge-call-end → BridgeCollector
 *   cold-start → NavigationCollector (live — emitted after page finishes, JS is ready)
 *   page-load-start / page-load-end / page-load-error → NavigationCollector.onBatchEvent
 *     (buffered — emitted during WebView lifecycle before JS is ready, flushed post-load)
 *   fps-drop-episode / long-task / memory-snapshot → RenderCollector
 *   hw-accel-change                               → ThreadCollector
 *   scroll-start / scroll-end                     → ScrollCollector
 *
 * Native batch routing (post-load idle drain — __catalystPerfBatch):
 *   boot-activity-created / boot-webview-constructed /
 *   boot-load-url / boot-page-started / boot-page-finished → NavigationCollector.onBatchEvent
 *   cache-hit-* / cache-miss-* / network-fetch-complete    → CacheCollector.onBatchEvent
 *   cache-summary                                          → CacheCollector.onBatchEvent
 *   api-call                                               → ApiCollector.onBatchEvent
 *
 * Cross-collector wiring:
 *   RenderCollector.addLoafListener → ScrollCollector.onLoaf
 *   RenderCollector.addLoafListener → HookCollector.onLoaf
 *   KeyboardCollector (scroll during keyboard) → ScrollCollector.onScrollDuringKeyboard
 *   NavigationCollector.isLoading → RenderCollector session context
 *   InteractionCollector.activeSessionId → BridgeCollector spans (sessionId tag)
 *   InteractionCollector.activeSessionId → RenderCollector fps-drop spans (sessionId tag)
 *   BridgeCollector / RenderCollector → InteractionCollector (onBridgeCall, onFpsDrop)
 *   CacheCollector.cache-summary → InsightsCollector.notifyCacheSummary
 *   All collectors → InsightsCollector (reactive warnings + session summary)
 */

import { Measure }              from './core/measure.js'
import { NavigationCollector }  from './collectors/NavigationCollector.js'
import { ScrollCollector }      from './collectors/ScrollCollector.js'
import { KeyboardCollector }    from './collectors/KeyboardCollector.js'
import { RenderCollector }      from './collectors/RenderCollector.js'
import { CacheCollector }       from './collectors/CacheCollector.js'
import { BridgeCollector }      from './collectors/BridgeCollector.js'
import { HookCollector }        from './collectors/HookCollector.js'
import { InteractionCollector } from './collectors/InteractionCollector.js'
import { InsightsCollector }    from './collectors/InsightsCollector.js'
import { ThreadCollector }      from './collectors/ThreadCollector.js'
import { ApiCollector }         from './collectors/ApiCollector.js'

class WebPerfCollector {
    constructor() {
        // Align native timestamps (SystemClock.elapsedRealtime) to performance.now() space.
        // Read lazily on each call — __NATIVE_TIME_OFFSET is injected via evaluateJavascript
        // in onPageStarted which may not have executed yet when this constructor runs.
        const nativeToWeb = (nativeMs) => nativeMs - (window.__NATIVE_TIME_OFFSET ?? 0)

        // ── Shared core ────────────────────────────────────────────────────────
        const measure = new Measure()

        // ── Collectors ─────────────────────────────────────────────────────────
        this._nav         = new NavigationCollector(measure, nativeToWeb)
        this._scroll      = new ScrollCollector(measure, nativeToWeb)
        this._keyboard    = new KeyboardCollector(measure, nativeToWeb)
        this._render      = new RenderCollector(measure, () => this._sessionContext(), nativeToWeb)
        this._cache       = new CacheCollector(measure, nativeToWeb)
        this._bridge      = new BridgeCollector(measure, nativeToWeb)
        this._hook        = new HookCollector(measure)
        this._interaction = new InteractionCollector(measure)
        this._insights    = new InsightsCollector(measure)
        this._thread      = new ThreadCollector(measure, nativeToWeb)
        this._api         = new ApiCollector(measure, nativeToWeb)

        // ── Cross-collector wiring ─────────────────────────────────────────────

        // LoAF → ScrollCollector + HookCollector
        this._render.addLoafListener((start, end) => this._scroll.onLoaf(start, end))
        this._render.addLoafListener((start, end) => this._hook.onLoaf(start, end))

        // LoAF during navigation → Insights
        this._render.addLoafListener((start, end) => {
            if (this._nav.isLoading) {
                this._insights.notifyLoafDuringNav(end - start)
            }
        })

        // Interaction session → BridgeCollector + RenderCollector
        this._bridge.setInteractionSource(() => this._interaction)
        this._render.setInteractionSource(() => this._interaction)

        // Bridge → Insights
        this._bridge.setInsightsSource((data) => this._insights.notifyBridgeCall(data))

        // Interaction → Insights (slow tap-to-paint)
        this._interaction.setInsightsSource((data) => this._insights.notifySlowInteraction(data))

        // Render → Insights (layout shift + memory)
        this._render.setInsightsSource((data) => {
            if (data.currentMb != null) this._insights.notifyHighMemory(data)
            else this._insights.notifyLayoutShift(data)
        })

        // Thread → Insights (hw-accel disabled during dropped frame)
        this._thread.setInsightsSource((data) => this._insights.notifyHwAccelDuringFrame(data))

        // Cache summary → Insights (low hit rate)
        this._cache.setInsightsSource((data) => this._insights.notifyCacheSummary(data))

        // Scroll jank → Insights
        this._scroll.setInsightsSource((data) => this._insights.notifyScrollJank(data))
    }

    static init(bridge) {
        if (window.__catalystPerfCollector) return
        const collector = new WebPerfCollector()
        window.__catalystPerfCollector = collector
        collector._setup(bridge)
        console.log('[CatalystPerf] active — nativeOffset:', collector._nativeOffset, 'ms')
    }

    _setup(bridge) {
        // Native → web event receiver (called directly by Kotlin via evaluateJavascript)
        window.__catalystPerfEvent = (jsonOrString) => {
            try {
                const event = typeof jsonOrString === 'string'
                    ? JSON.parse(jsonOrString)
                    : jsonOrString
                this._routeNativeEvent(event)
            } catch (e) {
                console.warn('[CatalystPerf] Bad native event payload:', jsonOrString, e)
            }
        }

        // Native batch flush receiver — called by Kotlin after onPageFinished + 250ms delay.
        // Drains via requestIdleCallback so web render is not blocked.
        window.__catalystPerfBatch = (jsonArrayString) => {
            try {
                console.log('[CatalystPerf] __catalystPerfBatch received, length=', typeof jsonArrayString === 'string' ? jsonArrayString.length : '?')
                const events = typeof jsonArrayString === 'string'
                    ? JSON.parse(jsonArrayString)
                    : jsonArrayString
                if (!Array.isArray(events) || events.length === 0) {
                    console.warn('[CatalystPerf] __catalystPerfBatch — empty or invalid array')
                    return
                }
                const typeSummary = events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc }, {})
                console.log('[CatalystPerf] __catalystPerfBatch events:', events.length, JSON.stringify(typeSummary))
                this._drainBatch(events)
            } catch (e) {
                console.warn('[CatalystPerf] Bad batch payload:', e)
            }
        }

        // WebBridge fallback registration (for frameworks that route via bridge callbacks)
        if (bridge) {
            bridge.register('CATALYST_PERF_EVENT', (data) => {
                window.__catalystPerfEvent(data)
            })
        }

        // Initialise all collectors
        this._nav.init()
        this._scroll.init()
        this._keyboard.init()
        this._render.init()
        this._cache.init()
        this._bridge.init()
        this._hook.init()
        this._interaction.init()
        this._insights.init()
        this._thread.init()
        this._api.init()
    }

    // ─── Native batch drain ───────────────────────────────────────────────────
    // Processes buffered native events (boot timing, cache, api-call) via
    // requestIdleCallback so the web thread stays free for rendering.

    _drainBatch(events) {
        let index = 0
        const CHUNK = 20  // process up to 20 events per idle slice

        const processChunk = (deadline) => {
            while (index < events.length) {
                if (deadline && deadline.timeRemaining() < 1) break
                this._routeBatchEvent(events[index++])
            }
            if (index < events.length) {
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(processChunk, { timeout: 2000 })
                } else {
                    // Fallback: setTimeout for environments without rIC
                    setTimeout(() => processChunk(null), 0)
                }
            } else {
                console.log(`[CatalystPerf] batch drained — ${events.length} events`)
            }
        }

        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(processChunk, { timeout: 2000 })
        } else {
            setTimeout(() => processChunk(null), 0)
        }
    }

    _routeBatchEvent(event) {
        const { type } = event
        if (type === 'page-load-start' || type === 'page-load-error') {
            this._nav.onNativeEvent(event)
        } else if (type === 'page-load-end') {
            this._nav.onNativeEvent(event)
            if (event.durationMs != null) {
                this._insights.notifySlowLoad({ url: event.url, durationMs: event.durationMs })
            }
        } else if (type?.startsWith('boot-')) {
            this._nav.onBatchEvent(event)
        } else if (type?.startsWith('cache-') || type === 'network-fetch-complete') {
            console.log('[CatalystPerf] routing cache event:', type, event.url?.slice(-40))
            this._cache.onBatchEvent(event)
        } else if (type === 'cache-summary') {
            console.log('[CatalystPerf] routing cache-summary:', JSON.stringify(event))
            this._cache.onBatchEvent(event)
        } else if (type === 'api-call') {
            this._api.onBatchEvent(event)
        } else if (type === 'cold-start') {
            this._nav.onNativeEvent(event)
            this._insights.notifyColdStart({ durationMs: event.durationMs })
        } else {
            // Unknown batch event — silently ignore (may be from future native additions)
        }
    }

    // ─── Native event router ──────────────────────────────────────────────────

    _routeNativeEvent(event) {
        switch (event.type) {
            case 'keyboard-show':
                this._keyboard.onKeyboardShow(event)
                break

            case 'keyboard-hide':
                this._keyboard.onKeyboardHide(event)
                break

            case 'cache-hit-memory':
            case 'cache-hit-disk':
            case 'cache-miss-fetch':
            case 'network-fetch-complete':
                // Legacy live path — only reached if buffer flush is disabled.
                // In normal operation, cache events go via __catalystPerfBatch.
                this._cache.onNativeEvent(event)
                break

            case 'bridge-call-start':
                this._bridge.onNativeEvent(event)
                break

            case 'bridge-call-end':
                this._bridge.onNativeEvent(event)
                // Insights notified directly from BridgeCollector._emitSpan via setInsightsSource
                break

            case 'page-load-start':
            case 'page-load-error':
                this._nav.onNativeEvent(event)
                break

            case 'page-load-end': {
                this._nav.onNativeEvent(event)
                if (event.durationMs != null) {
                    this._insights.notifySlowLoad({ url: event.url, durationMs: event.durationMs })
                }
                break
            }

            case 'cold-start':
                this._nav.onNativeEvent(event)
                this._insights.notifyColdStart({ durationMs: event.durationMs })
                break

            case 'fps-drop-episode': {
                this._render.onNativeEvent(event)
                // Option B: feed fps-drop into scroll session if one is open
                if (this._scroll._session.isOpen) {
                    this._scroll.onFpsDrop(event)
                }
                this._insights.notifyFpsDrop({
                    minFps:            event.minFps,
                    avgFps:            event.avgFps,
                    durationMs:        event.durationMs,
                    duringInteraction: this._interaction.activeSessionId != null,
                    deltaFps:          event.deltaFps ?? null,
                    baselineFps:       event.baselineFps ?? null,
                })
                break
            }

            case 'long-task':
                this._render.onNativeEvent(event)
                break

            case 'memory-snapshot':
                this._render.onNativeEvent(event)
                // Insights notified from RenderCollector via setInsightsSource (uses nativeMb)
                break

            case 'scroll-start':
                this._scroll.onScrollStart(event)
                break

            case 'scroll-end':
                this._scroll.onScrollEnd(event)
                break


            case 'hw-accel-change':
                this._thread.onNativeEvent(event)
                break

            case 'navigation-back':
                // Emit via NavigationCollector as a point-in-time batch-style event
                this._nav.onBatchEvent(event)
                break

            default:
                console.warn('[CatalystPerf] Unknown native event type:', event.type)
        }
    }

    // ─── Session context helper ───────────────────────────────────────────────
    // Used by RenderCollector to tag LoAF and layout-shift entries with the
    // active session so you can see in DevTools which phase a bad frame belongs to.

    _sessionContext() {
        if (this._nav.isLoading)             return 'navigation'
        if (this._scroll._session.isOpen)    return 'scroll'
        if (this._keyboard._session.isOpen)  return 'keyboard'
        return 'none'
    }
}

export default WebPerfCollector
