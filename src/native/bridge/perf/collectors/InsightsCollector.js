/**
 * InsightsCollector.js
 *
 * Watches accumulated perf data and emits actionable warnings to the
 * Catalyst > Insights track in Chrome DevTools.
 *
 * Each insight is a point-in-time span with:
 *   - severity: 'critical' | 'warning' | 'info'
 *   - rule:     short machine-readable id (e.g. 'bridge-too-slow')
 *   - message:  one-sentence human diagnosis
 *   - fix:      immediate actionable recommendation
 *   - evidence: the numbers that triggered the rule
 *
 * Insights are emitted in two modes:
 *   1. Reactive — emitted immediately when a threshold breach is detected
 *      (e.g. a bridge call times out, an fps-drop episode during interaction)
 *   2. Summary — emitted once after SESSION_SUMMARY_DELAY_MS of inactivity
 *      to give a rolled-up view of what happened in the last session
 *
 * How to read this in DevTools:
 *   Performance tab → Catalyst > Insights track
 *   Click any span → Tooltip shows: severity, rule, message, fix, evidence
 *   Red spans = critical (user-visible jank/failure)
 *   Yellow (tertiary) = warning
 *   Blue (secondary) = info / optimization opportunity
 */

import { TRACK, PREFIX, THRESHOLD } from '../core/constants.js'

const SESSION_SUMMARY_DELAY_MS = 3000

export class InsightsCollector {
    constructor(measure) {
        this._measure       = measure
        this._summaryTimer  = null

        // Counters reset per session
        this._bridgeTimeouts  = 0
        this._slowBridgeCalls = []   // [{ method, roundTripMs }]
        this._fpsDrops        = []   // [{ minFps, durationMs }]
        this._slowLoads       = []   // [{ url, durationMs }]
        this._loafsDuringNav  = 0
        this._slowInteractions = []  // [{ target, responseMs }]
        this._highMemory      = []   // [{ currentMb }]
        this._layoutShifts    = []   // [{ value }]
        this._coldStartMs     = null // always attached to other insights once known
    }

    init() {
        // No web observers — fed via notify*() methods from index.js
    }

    // ─── Feed methods — called by index.js after routing native events ─────────

    notifyBridgeCall({ method, roundTripMs, timedOut }) {
        if (timedOut) {
            this._bridgeTimeouts++
            this._emitReactive({
                severity: 'critical',
                rule:     'bridge-timeout',
                message:  `Bridge call '${method}' never returned`,
                fix:      'Check native handler for the method — it may be throwing silently or not calling the callback',
                evidence: { method },
            })
        } else if (roundTripMs > THRESHOLD.BRIDGE_SLOW_MS) {
            this._slowBridgeCalls.push({ method, roundTripMs })
            if (roundTripMs > 500) {
                this._emitReactive({
                    severity: 'warning',
                    rule:     'bridge-too-slow',
                    message:  `Bridge call '${method}' took ${roundTripMs}ms (threshold ${THRESHOLD.BRIDGE_SLOW_MS}ms)`,
                    fix:      'Move heavy work off the main thread on the native side; batch calls to reduce round-trips',
                    evidence: { method, roundTripMs, thresholdMs: THRESHOLD.BRIDGE_SLOW_MS },
                })
            }
        }
        this._scheduleSummary()
    }

    notifyFpsDrop({ minFps, avgFps, durationMs, duringInteraction, deltaFps, baselineFps }) {
        this._fpsDrops.push({ minFps, durationMs })
        if (duringInteraction) {
            this._emitReactive({
                severity: 'critical',
                rule:     'fps-drop-during-tap',
                message:  `FPS dropped to ${minFps.toFixed(1)} for ${Math.round(durationMs)}ms right after a tap`,
                fix:      'A bridge call or heavy computation is blocking the render thread after interaction — check BridgeCollector spans in the same session',
                evidence: { minFps, avgFps, durationMs, deltaFps, baselineFps },
            })
        } else if (minFps < 30) {
            this._emitReactive({
                severity: 'warning',
                rule:     'severe-fps-drop',
                message:  `Severe FPS drop: ${minFps.toFixed(1)}fps min for ${Math.round(durationMs)}ms`,
                fix:      'Look for LoAF spans overlapping this window on the Render track — a long script or layout is stalling frames',
                evidence: { minFps, avgFps, durationMs, deltaFps, baselineFps },
            })
        } else if (deltaFps != null && deltaFps >= 10) {
            // Sudden spike: FPS fell sharply even if absolute value is not critical
            this._emitReactive({
                severity: 'warning',
                rule:     'fps-spike-drop',
                message:  `Sudden FPS spike: dropped ${deltaFps.toFixed(1)}fps (${baselineFps?.toFixed(1)} → ${minFps.toFixed(1)}) in one frame window`,
                fix:      'A sudden spike drop — often a one-off heavy layout, image decode, or synchronous bridge call. Check Render track for a LoAF aligned with this episode.',
                evidence: { minFps, avgFps, durationMs, deltaFps, baselineFps },
            })
        }
        this._scheduleSummary()
    }

    notifySlowLoad({ url, durationMs }) {
        this._slowLoads.push({ url, durationMs })
        if (durationMs > 4000) {
            this._emitReactive({
                severity: 'critical',
                rule:     'page-load-too-slow',
                message:  `Page load took ${Math.round(durationMs)}ms (${url.split('/').pop() || url})`,
                fix:      'Check Cache track for cache-miss-fetch bursts; consider preloading route chunks or warming the WebView cache',
                evidence: { url, durationMs },
            })
        }
        this._scheduleSummary()
    }

    notifyColdStart({ durationMs }) {
        this._coldStartMs = durationMs  // attach to all future insights automatically
        const severity = durationMs > 3000 ? 'critical'
                       : durationMs > 1800 ? 'warning'
                       : 'info'
        const label    = durationMs > 3000 ? 'slow'
                       : durationMs > 1800 ? 'acceptable'
                       : 'fast'
        this._emitReactive({
            severity,
            rule:     'cold-start-time',
            message:  `Cold start: ${Math.round(durationMs)}ms (${label}) — app launched to first page finish`,
            fix:      durationMs > 3000
                ? 'Cold start >3s — check if WebView.loadUrl() is called before layout inflation completes; defer non-critical MainActivity init; consider prewarming WebView in Application.onCreate()'
                : durationMs > 1800
                ? 'Cold start >1.8s — consider moving WebView construction earlier (Application.onCreate vs MainActivity.onCreate); check if large local assets block onPageFinished'
                : 'Cold start within target (≤1.8s). No action needed.',
            evidence: { durationMs, targetMs: 1800, acceptableMs: 3000 },
        })
    }

    notifyLoafDuringNav(durationMs) {
        this._loafsDuringNav++
        if (this._loafsDuringNav === 1) {
            this._emitReactive({
                severity: 'warning',
                rule:     'loaf-blocking-nav',
                message:  `Long animation frame (${Math.round(durationMs)}ms) fired during navigation — may cause blank screen`,
                fix:      'Defer non-critical JS execution after page-load-end; split large bundles with dynamic import()',
                evidence: { durationMs, loafsDuringNav: this._loafsDuringNav },
            })
        }
    }

    notifySlowInteraction({ target, responseMs }) {
        this._slowInteractions.push({ target, responseMs })
        if (responseMs > 300) {
            this._emitReactive({
                severity: 'critical',
                rule:     'interaction-unresponsive',
                message:  `Tap on '${target}' took ${responseMs}ms to paint (threshold ${THRESHOLD.INTERACTION_SLOW_MS}ms)`,
                fix:      'A LoAF or bridge call is delaying the paint — check if the tap handler triggers a synchronous bridge call',
                evidence: { target, responseMs, thresholdMs: THRESHOLD.INTERACTION_SLOW_MS },
            })
        }
        this._scheduleSummary()
    }

    notifyHighMemory({ currentMb }) {
        // currentMb is webviewMb (V8 + Blink + JNI PSS) — the WebView engine memory.
        // A healthy WebView app idles at 80-120MB. Growth beyond that signals
        // a real leak (un-released image bitmaps, accumulating JS closures, JNI objects).
        // Thresholds are intentionally higher than total-PSS thresholds used previously
        // because we now track the native slice, not the whole process.
        this._highMemory.push({ currentMb })
        if (currentMb > 120) {
            this._emitReactive({
                severity: 'critical',
                rule:     'memory-critical',
                message:  `WebView memory at ${Math.round(currentMb)}MB — above 120MB critical threshold (V8/Blink/JNI leak likely)`,
                fix:      'Check for un-released image bitmaps, accumulating JS closures, or JNI objects not returned to GC. Compare webviewMb growth across snapshots on the Render track.',
                evidence: { webviewMb: currentMb },
            })
        } else if (currentMb > 80) {
            this._emitReactive({
                severity: 'warning',
                rule:     'memory-high',
                message:  `WebView memory at ${Math.round(currentMb)}MB — above 80MB warning threshold (healthy idle is <80MB)`,
                fix:      'Monitor webviewMb trend on Render track — sustained growth = leak. Check image cache eviction, dispose WebView event listeners on route unmount.',
                evidence: { webviewMb: currentMb },
            })
        }
    }

    notifyHwAccelDuringFrame({ durationMs, thread, trigger }) {
        this._emitReactive({
            severity: 'critical',
            rule:     'hw-accel-during-frame',
            message:  `Software rendering was active for ${Math.round(durationMs)}ms during a dropped frame (hw-accel disabled by ${trigger ?? 'cache-serve'})`,
            fix:      'Cache serving on shouldInterceptRequest disables hardware acceleration — move cache I/O off the WebView thread or batch cache warming on app start to reduce mid-session hw-accel toggles',
            evidence: { durationMs, thread: thread ?? 'unknown', trigger: trigger ?? 'unknown' },
        })
    }

    notifyLayoutShift({ value, sessionContext }) {
        this._layoutShifts.push({ value })
        if (value > 0.25) {
            this._emitReactive({
                severity: 'warning',
                rule:     'large-layout-shift',
                message:  `Large layout shift (CLS ${value.toFixed(3)}) during '${sessionContext}' phase`,
                fix:      'Reserve space for async-loaded content (images, ads, banners) using explicit height; avoid injecting DOM above visible content',
                evidence: { value, sessionContext },
            })
        }
    }

    notifyScrollJank({ minFps, frameDropCount }) {
        const severity = minFps < 30 ? 'critical' : 'warning'
        const rule     = minFps < 30 ? 'scroll-jank-critical' : 'scroll-jank-warning'
        this._emitReactive({
            severity,
            rule,
            message:  `Scroll jank: ${Math.round(frameDropCount)} frame drop(s), min ${minFps.toFixed(1)}fps during scroll`,
            fix:      minFps < 30
                ? 'Severe scroll jank — check for synchronous bridge calls or layout thrash triggered during scroll. Look for LoAF spans on Render track overlapping the Input track scroll session.'
                : 'Scroll dropped below 55fps — common causes: sticky header recalc, cart badge updates, or image decode on scroll. Check Render track LoAF spans inside the scroll session.',
            evidence: { minFps, frameDropCount },
        })
        this._scheduleSummary()
    }

    notifyCacheSummary({ hitRatePct, total, avgFetchMs }) {
        if (total < 5) return  // not enough data
        if (hitRatePct < 50) {
            this._emitReactive({
                severity: 'warning',
                rule:     'low-cache-hit-rate',
                message:  `Cache hit rate ${hitRatePct}% (${total} resources) — majority served via network`,
                fix:      'Add missed URLs to the allowedUrls cache list; check cache max-age and disk eviction policy',
                evidence: { hitRatePct, total, avgFetchMs },
            })
        }
    }

    // ─── Reactive insight emission ─────────────────────────────────────────────

    _emitReactive({ severity, rule, message, fix, evidence }) {
        const now       = performance.now()
        const markName  = `${PREFIX.INSIGHT}:${rule}:${Math.round(now)}`
        const color     = severity === 'critical' ? 'error'
                        : severity === 'warning'  ? 'tertiary'
                        : 'secondary'

        performance.mark(markName, { startTime: now })
        this._measure.emit(
            `${PREFIX.INSIGHT}|${rule}`,
            markName,
            now + 2,  // point-in-time, minimal duration
            {
                severity,
                rule,
                message,
                fix,
                ...(this._coldStartMs != null ? { 'coldStart.ms': String(Math.round(this._coldStartMs)) } : {}),
                ...Object.fromEntries(
                    Object.entries(evidence).map(([k, v]) => [`evidence.${k}`, String(v)])
                ),
            },
            TRACK.INSIGHTS,
            color
        )
    }

    // ─── Session summary ───────────────────────────────────────────────────────
    // Emitted after SESSION_SUMMARY_DELAY_MS of quiet — a rolled-up health check.

    _scheduleSummary() {
        if (this._summaryTimer) clearTimeout(this._summaryTimer)
        this._summaryTimer = setTimeout(() => this._emitSummary(), SESSION_SUMMARY_DELAY_MS)
    }

    _emitSummary() {
        this._summaryTimer = null

        const problems = []
        if (this._bridgeTimeouts > 0)
            problems.push(`${this._bridgeTimeouts} bridge timeout(s)`)
        if (this._fpsDrops.length > 0)
            problems.push(`${this._fpsDrops.length} fps-drop episode(s), min ${Math.min(...this._fpsDrops.map(f => f.minFps)).toFixed(0)}fps`)
        if (this._slowLoads.length > 0)
            problems.push(`${this._slowLoads.length} slow page load(s)`)
        if (this._slowInteractions.length > 0)
            problems.push(`${this._slowInteractions.length} slow tap(s)`)
        if (this._highMemory.length > 0)
            problems.push(`peak ${Math.max(...this._highMemory.map(m => m.currentMb)).toFixed(0)}MB memory`)

        const severity = this._bridgeTimeouts > 0 || this._fpsDrops.some(f => f.minFps < 20)
            ? 'critical'
            : problems.length > 2 ? 'warning' : 'info'

        const message = problems.length === 0
            ? 'Session clean — no threshold breaches detected'
            : `Session issues: ${problems.join(' · ')}`

        const fix = problems.length === 0
            ? 'No action needed'
            : 'Expand each red/yellow span above for per-issue fixes'

        this._emitReactive({
            severity: severity === 'info' ? 'info' : severity,
            rule:     'session-summary',
            message,
            fix,
            evidence: {
                bridgeTimeouts:    this._bridgeTimeouts,
                slowBridgeCalls:   this._slowBridgeCalls.length,
                fpsDropEpisodes:   this._fpsDrops.length,
                slowPageLoads:     this._slowLoads.length,
                slowInteractions:  this._slowInteractions.length,
                highMemoryReadings: this._highMemory.length,
                layoutShifts:      this._layoutShifts.length,
            },
        })

        // Reset counters for next session
        this._bridgeTimeouts   = 0
        this._slowBridgeCalls  = []
        this._fpsDrops         = []
        this._slowLoads        = []
        this._loafsDuringNav   = 0
        this._slowInteractions = []
        this._highMemory       = []
        this._layoutShifts     = []
    }
}
