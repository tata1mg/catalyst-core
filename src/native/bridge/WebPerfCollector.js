/**
 * WebPerfCollector.js
 *
 * Collects web + native performance events and emits them as
 * performance.mark() / performance.measure() entries visible in
 * Chrome DevTools → Performance tab → Catalyst track group.
 *
 * All measures use the "catalyst:" prefix so they're easy to filter.
 *
 * Activation: called automatically from WebBridge.init() — no app changes needed.
 *
 * Native → web event flow:
 *   Kotlin emits window.__catalystPerfEvent(jsonString)
 *   → WebPerfCollector handles it
 *   → performance.measure('catalyst:...') created with detail.devtools
 *   → visible in Chrome DevTools → Performance → Catalyst track group (Chrome 128+)
 *   → falls back to Timings row on older Chrome
 *
 * Chrome DevTools track layout (trackGroup: 'Catalyst'):
 *   Track: Navigation  — session/navigation, lcp, fcp
 *   Track: Scroll      — session/scroll
 *   Track: Keyboard    — session/keyboard, viewport-resize
 *   Track: Render      — loaf, layout-shift
 *   Track: Cache       — cache-group/*, cache/* leaf spans
 *
 * Color philosophy (Chrome DevTools Extensibility API):
 *   error     → Catalyst-defined bad state (LoAF, LCP>2.5s, fetch>300ms, CLS>0.1)
 *   primary   → happy path (cache hit, good LCP, clean scroll)
 *   secondary — informational (keyboard, viewport)
 *   tertiary  — low-signal (cache miss, small layout shift)
 *
 * Session groups (parent spans):
 *   catalyst:session/navigation  — page start → LCP finalized
 *   catalyst:session/scroll      — first scroll → 150ms idle
 *   catalyst:session/keyboard    — keyboard-show → viewport stable
 *
 * Cache/network events (always leaf spans):
 *   catalyst:cache/<spanType>|<resourceType>|<label>
 *   e.g. catalyst:cache/memory|script|pages-Login.js
 *   Timestamps aligned with native via window.__NATIVE_TIME_OFFSET.
 */

class WebPerfCollector {
    constructor() {
        // Offset added to performance.now() to align with native SystemClock.elapsedRealtime().
        this._nativeOffset = window.__NATIVE_TIME_OFFSET ?? 0

        // Active mark names keyed by spanId so we can close them later.
        this._openSpans = new Map()

        // ─── Session state ────────────────────────────────────────────────────
        // navigation session: open from navigationStart → closes when LCP finalizes
        this._navSession = null        // { startMark, startTime }

        // keyboard session: open from keyboard-show → closes when viewport stable
        this._keyboardSession = null   // { startMark, startTime, keyboardHeight }

        // scroll session: open from first scroll → closes 150ms after last scroll
        this._scrollSession = null     // { startMark, startTime, loafCount }
        this._scrollEndTimer = null

        // ─── LCP deduplication ───────────────────────────────────────────────
        // LCP fires multiple times as larger candidates are found.
        // We buffer the last entry and emit only when finalized.
        this._pendingLcp = null        // { entry, label }

        // ─── LoAF rolling window (for overlap detection) ──────────────────────
        this._recentLoafs = []

        // ─── Cache grouping sessions ───────────────────────────────────────
        // Each cache type gets its own parent span for grouping in timeline.
        // Sessions: { startMark, startTime, isOpen }
        this._cacheGroups = {
            memory: null,
            disk: null,
            miss: null,
            fetch: null,
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    static init(bridge) {
        if (window.__catalystPerfCollector) return
        const collector = new WebPerfCollector()
        window.__catalystPerfCollector = collector
        collector._setup(bridge)
        console.log("[CatalystPerf] WebPerfCollector active — offset:", collector._nativeOffset, "ms")
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    _setup(bridge) {
        // 1. Native → web event receiver
        window.__catalystPerfEvent = (jsonOrString) => {
            try {
                const event = typeof jsonOrString === "string" ? JSON.parse(jsonOrString) : jsonOrString
                this._handleNativeEvent(event)
            } catch (e) {
                console.warn("[CatalystPerf] Bad event payload:", jsonOrString, e)
            }
        }

        // 2. WebBridge fallback registration
        if (bridge) {
            bridge.register("CATALYST_PERF_EVENT", (data) => {
                window.__catalystPerfEvent(data)
            })
        }

        // 3. Open navigation session immediately
        this._openNavSession()

        // 4. Web-side observers
        this._observeLoAF()
        this._observeLayoutShift()
        this._observeLCP()
        this._observeScroll()
        this._observeVisualViewport()

        // 5. Finalize LCP when user interacts or page hides
        //    (browser stops updating LCP candidate at this point)
        const finalizeLcp = () => {
            this._finalizeLcp()
            document.removeEventListener("pointerdown", finalizeLcp)
            document.removeEventListener("keydown", finalizeLcp)
        }
        document.addEventListener("pointerdown", finalizeLcp)
        document.addEventListener("keydown", finalizeLcp)
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") this._finalizeLcp()
        })
    }

    // ─── Navigation session ───────────────────────────────────────────────────

    _openNavSession() {
        const startTime = performance.now()
        const startMark = "catalyst:session/navigation:start"
        performance.mark(startMark, { startTime })
        this._navSession = { startMark, startTime }
    }

    _closeNavSession(endTime) {
        if (!this._navSession) return
        const { startMark, startTime } = this._navSession
        this._navSession = null
        this._measure("catalyst:session/navigation", startMark, endTime, {
            duration: Math.round(endTime - startTime),
            simulatorValid: false,
        }, 'Navigation')
    }

    // ─── LCP (deduped, finalized on interaction/hide) ─────────────────────────

    _observeLCP() {
        const types = PerformanceObserver.supportedEntryTypes ?? []
        const type = types.includes("largest-contentful-paint")
            ? "largest-contentful-paint"
            : types.includes("paint")
            ? "paint"
            : null
        if (!type) return

        const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (type === "paint" && entry.name !== "first-contentful-paint") continue
                const label = type === "largest-contentful-paint" ? "lcp" : "fcp"
                // Buffer — overwrite any previous candidate
                this._pendingLcp = { entry, label }
            }
        })
        obs.observe({ type, buffered: true })
    }

    _finalizeLcp() {
        if (!this._pendingLcp) return
        const { entry, label } = this._pendingLcp
        this._pendingLcp = null

        const markName = `catalyst:${label}:mark`
        performance.mark(markName, { startTime: 0 })
        this._measure(`catalyst:${label}|${Math.round(entry.startTime)}ms`, markName, entry.startTime, {
            renderTime: entry.renderTime ?? null,
            loadTime: entry.loadTime ?? null,
            group: "navigation",
            simulatorValid: false,
        }, 'Navigation')

        // Close the navigation session — LCP finalized = page loaded
        this._closeNavSession(entry.startTime)
    }

    // ─── LoAF (Long Animation Frames) ─────────────────────────────────────────

    _observeLoAF() {
        if (!PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) return
        const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const start = entry.startTime
                const end = start + entry.duration

                this._recentLoafs.push({ start, end })
                if (this._recentLoafs.length > 5) this._recentLoafs.shift()

                // Increment scroll loaf counter if scroll session is open
                if (this._scrollSession) this._scrollSession.loafCount++

                // Determine which session this LoAF belongs to
                const group = this._navSession
                    ? "navigation"
                    : this._scrollSession
                    ? "scroll"
                    : this._keyboardSession
                    ? "keyboard"
                    : "none"

                const startMark = `catalyst:loaf:${Math.round(start)}`
                performance.mark(startMark, { startTime: start })
                this._measure(`catalyst:loaf|${Math.round(entry.duration)}ms`, startMark, end, {
                    blockingDuration: entry.blockingDuration,
                    scripts: entry.scripts?.length ?? 0,
                    group,
                    simulatorValid: false,
                }, 'Render')
            }
        })
        obs.observe({ type: "long-animation-frame", buffered: true })
    }

    // ─── Layout shift ─────────────────────────────────────────────────────────

    _observeLayoutShift() {
        if (!PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) return
        const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.hadRecentInput) continue

                const group = this._navSession
                    ? "navigation"
                    : this._scrollSession
                    ? "scroll"
                    : this._keyboardSession
                    ? "keyboard"
                    : "none"

                const markName = `catalyst:cls:${Math.round(entry.startTime)}`
                performance.mark(markName, { startTime: entry.startTime })
                this._measure(`catalyst:layout-shift|${entry.value.toFixed(4)}`, markName, entry.startTime + 1, {
                    value: entry.value,
                    group,
                    simulatorValid: false,
                }, 'Render')
            }
        })
        obs.observe({ type: "layout-shift", buffered: true })
    }

    // ─── Scroll session ───────────────────────────────────────────────────────

    _observeScroll() {
        window.addEventListener(
            "scroll",
            () => {
                if (!this._scrollSession) {
                    const startTime = performance.now()
                    const startMark = "catalyst:session/scroll:start"
                    performance.mark(startMark, { startTime })
                    this._scrollSession = { startMark, startTime, loafCount: 0 }
                }

                clearTimeout(this._scrollEndTimer)
                this._scrollEndTimer = setTimeout(() => {
                    const end = performance.now()
                    const { startMark, startTime, loafCount } = this._scrollSession
                    this._scrollSession = null
                    this._measure("catalyst:session/scroll", startMark, end, {
                        duration: Math.round(end - startTime),
                        loafCount,
                        janky: loafCount > 0,
                        simulatorValid: false,
                    }, 'Scroll')
                }, 150)
            },
            { passive: true }
        )
    }

    // ─── Keyboard + viewport session ──────────────────────────────────────────

    _handleNativeEvent(event) {
        switch (event.type) {
            case "keyboard-show":   this._onKeyboardShow(event);   break
            case "keyboard-hide":   this._onKeyboardHide(event);   break
            case "cache-hit-memory":
            case "cache-hit-disk":
            case "cache-miss-fetch":
            case "network-fetch-complete":
                this._onCacheNetworkEvent(event)
                break
            default:
                console.warn("[CatalystPerf] Unknown native event type:", event.type)
        }
    }

    _onKeyboardShow(event) {
        const webNow = this._nativeToWeb(event.nativeTime)
        const startMark = "catalyst:session/keyboard:start"
        performance.mark(startMark, { startTime: webNow })
        this._keyboardSession = { startMark, startTime: webNow, keyboardHeight: event.keyboardHeight }
    }

    _onKeyboardHide(event) {
        const webNow = this._nativeToWeb(event.nativeTime)
        if (this._keyboardSession) {
            this._closeKeyboardSession(webNow)
        }
        performance.mark("catalyst:keyboard-hide", { startTime: webNow })
    }

    _observeVisualViewport() {
        if (!window.visualViewport) return
        let lastHeight = window.visualViewport.height
        window.visualViewport.addEventListener("resize", () => {
            const now = performance.now()
            const newHeight = window.visualViewport.height
            const delta = Math.abs(newHeight - lastHeight)
            lastHeight = newHeight
            if (delta < 50) return

            const startMark = "catalyst:viewport-resize-start"
            performance.mark(startMark, { startTime: now })

            requestAnimationFrame(() => {
                const end = performance.now()
                this._measure("catalyst:viewport-resize", startMark, end, {
                    deltaHeight: Math.round(delta),
                    group: "keyboard",
                    simulatorValid: true,
                }, 'Keyboard')
                // Viewport settled → keyboard session ends
                if (this._keyboardSession) {
                    this._closeKeyboardSession(end)
                }
            })
        })
    }

    _closeKeyboardSession(endTime) {
        if (!this._keyboardSession) return
        const { startMark, startTime, keyboardHeight } = this._keyboardSession
        this._keyboardSession = null
        this._measure("catalyst:session/keyboard", startMark, endTime, {
            duration: Math.round(endTime - startTime),
            keyboardHeight,
            simulatorValid: false,
        }, 'Keyboard')
    }

    // ─── Cache grouping (parent spans for timeline lanes) ────────────────────
    // Each cache type (memory, disk, miss, fetch) gets a parent span.
    // Child cache events nest under these parent spans in Chrome DevTools.

    _ensureCacheGroupOpen(spanType, startTime) {
        if (this._cacheGroups[spanType]) return // Already open

        const groupMark = `catalyst:cache-group/${spanType}:start`
        performance.mark(groupMark, { startTime })
        this._cacheGroups[spanType] = { startMark: groupMark, startTime, events: [] }
    }

    _addEventToCacheGroup(spanType, startTime, endTime) {
        if (!this._cacheGroups[spanType]) return
        this._cacheGroups[spanType].events.push({ startTime, endTime })
    }

    _closeCacheGroupIfIdle(spanType, currentTime) {
        const group = this._cacheGroups[spanType]
        if (!group) return

        // Close the group if no events have fired in the last 300ms
        const lastEventEnd = Math.max(...group.events.map((e) => e.endTime), group.startTime)
        if (currentTime - lastEventEnd > 300) {
            const { startMark, startTime } = group
            this._cacheGroups[spanType] = null
            this._measure(`catalyst:cache-group/${spanType}`, startMark, currentTime, {
                eventCount: group.events.length,
                detail: `${spanType} cache events grouped`,
                simulatorValid: false,
            }, 'Cache')
        }
    }

    // ─── Cache / network events ───────────────────────────────────────────────
    //
    // Timestamps come from native (nativeStartMs via SystemClock.elapsedRealtime()).
    // Converted to web timeline using window.__NATIVE_TIME_OFFSET so spans align
    // with LCP, LoAF, and other web-measured events in Chrome DevTools Timings row.
    //
    // Measure name format: catalyst:cache/<spanType>|<resourceType>|<label>
    //   e.g. catalyst:cache/memory|script|pages-Login.js
    //        catalyst:cache/miss|stylesheet|app.css
    //        catalyst:cache/fetch|image|logo.png

    _onCacheNetworkEvent(event) {
        const { url, durationMs, nativeStartMs, resourceType, thread, type, statusCode } = event
        const label = this._shortUrl(url)
        const spanType = type === "cache-hit-memory" ? "memory"
            : type === "cache-hit-disk"   ? "disk"
            : type === "cache-miss-fetch" ? "miss"
            : "fetch"
        const resType = resourceType ?? "other"

        // Use native start timestamp if available (properly aligned via __NATIVE_TIME_OFFSET).
        // Fall back to backdating from performance.now() if nativeStartMs is missing.
        const endTime = nativeStartMs != null
            ? this._nativeToWeb(nativeStartMs) + durationMs
            : performance.now()
        const startTime = endTime - durationMs

        // Ensure cache group parent span is open
        this._ensureCacheGroupOpen(spanType, startTime)
        this._addEventToCacheGroup(spanType, startTime, endTime)

        const measureName = `catalyst:cache/${spanType}|${resType}|${label}`
        const startMark = `${measureName}:start`

        performance.mark(startMark, { startTime })
        this._measure(measureName, startMark, endTime, {
            url,
            resourceType: resType,
            source: spanType === "fetch" ? "network" : "cache",
            cacheHit: spanType !== "miss",
            thread,
            statusCode: statusCode ?? null,
            group: "cache",
            simulatorValid: false,
            loafOverlap: this._overlapsLoAF(startTime, endTime),
        }, 'Cache')

        // Check if this group should close (no events for 300ms)
        setTimeout(() => this._closeCacheGroupIfIdle(spanType, performance.now()), 300)
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _nativeToWeb(nativeElapsedMs) {
        return nativeElapsedMs - this._nativeOffset
    }

    /**
     * Emit a performance.measure() with Chrome DevTools Extensibility API metadata.
     *
     * @param {string} name        - measure name (catalyst:...)
     * @param {string} startMark   - name of the opening performance.mark()
     * @param {number} endTime     - end time in ms (performance.now()-space)
     * @param {object} detail      - arbitrary detail fields (loafOverlap, group, etc.)
     * @param {string} track       - Chrome DevTools track name ('Cache'|'Navigation'|'Scroll'|'Keyboard'|'Render')
     * @param {string} [color]     - override color; defaults to _colorFor(name, detail)
     */
    _measure(name, startMark, endTime, detail = {}, track = 'Navigation', color = null) {
        try {
            const resolvedColor = color ?? this._colorFor(name, detail)
            // Chrome DevTools Extensibility API (Chrome 128+):
            // - detail must be { devtools: { ... } } — custom data goes in properties[]
            // - start and end must both be numeric timestamps (ms), not mark names.
            //   Mixing a mark-name start with a numeric end silently falls back to Timings row.
            const startTime = performance.getEntriesByName(startMark, 'mark')[0]?.startTime
            if (startTime == null) {
                console.warn("[CatalystPerf] measure skipped — mark not found:", startMark)
                return
            }
            const properties = Object.entries(detail).filter(([k]) => k !== 'devtools')
            performance.measure(name, {
                start: startTime,
                end: endTime,
                detail: {
                    devtools: {
                        dataType: 'track-entry',
                        trackGroup: 'Catalyst',
                        track,
                        color: resolvedColor,
                        tooltipText: name,
                        properties,
                    }
                }
            })
        } catch (e) {
            console.warn("[CatalystPerf] measure failed:", name, e.message)
        }
    }

    /**
     * Derive a DevTools color from the span name and detail fields.
     *
     * Rules (in priority order):
     *   error     → any Catalyst-defined bad state
     *   primary   → happy path
     *   secondary → informational (keyboard / viewport)
     *   tertiary  → low-signal (cache miss, tiny CLS)
     */
    _colorFor(name, detail) {
        // LoAF is always a bad frame — always error
        if (name.startsWith('catalyst:loaf')) return 'error'

        // LCP bad if > 2500ms
        if (name.startsWith('catalyst:lcp') && detail.renderTime > 2500) return 'error'
        if (name.startsWith('catalyst:lcp')) return 'primary'
        if (name.startsWith('catalyst:fcp')) return 'primary'

        // Navigation session — error if it ran long (proxy: LCP fired late, i.e. session closed late)
        if (name === 'catalyst:session/navigation') return detail.duration > 2500 ? 'error' : 'primary'

        // Scroll session — error if janky
        if (name === 'catalyst:session/scroll') return detail.janky ? 'error' : 'primary'

        // Keyboard / viewport — informational
        if (name.startsWith('catalyst:session/keyboard')) return 'secondary'
        if (name.startsWith('catalyst:viewport-resize')) return 'secondary'

        // Layout shift — error if bad CLS (>0.1 per entry is significant)
        if (name.startsWith('catalyst:layout-shift')) return detail.value > 0.1 ? 'error' : 'tertiary'

        // Cache leaf spans
        if (name.startsWith('catalyst:cache/')) {
            if (detail.loafOverlap) return 'error'          // cache fetch blocked a frame
            if (!detail.cacheHit && detail.source === 'network' && detail.duration > 300) return 'error'
            if (detail.cacheHit) return 'primary'           // memory or disk hit
            return 'tertiary'                               // cache miss (will fetch)
        }

        // Cache group parent spans
        if (name.startsWith('catalyst:cache-group/fetch')) return 'tertiary'
        if (name.startsWith('catalyst:cache-group/miss'))  return 'tertiary'
        if (name.startsWith('catalyst:cache-group/'))      return 'primary'

        return 'secondary'
    }

    _overlapsLoAF(startMs, endMs) {
        return this._recentLoafs.some((loaf) => startMs < loaf.end && endMs > loaf.start)
    }

    _shortUrl(url) {
        try {
            return new URL(url).pathname.slice(0, 40)
        } catch {
            return url.slice(0, 40)
        }
    }
}

export default WebPerfCollector
