/**
 * NavigationCollector.js
 *
 * Instruments: bugs #2, #7, #9, #11, #14
 *   #2  back-forward reloads screen     → new nav session opens, cache miss burst follows
 *   #7  header disappears on back       → route-transition span shows animation torn down early
 *   #9  forward transition broken       → route-transition fires but no visual end mark
 *   #11 banner overlaps search box      → nav session ends but layout-shift fires after
 *   #14 transitions not soft            → skeleton→content swap visible as layout-shift during nav
 *
 * Spans emitted:
 *   catalyst:session/navigation         — page start → LCP finalized (Track: Navigation)
 *   catalyst:route-transition|<from→to> — popstate/hashchange → rAF settle (Track: Navigation)
 *   catalyst:lcp|<ms>ms                 — LCP candidate finalized (Track: Navigation)
 *   catalyst:fcp|<ms>ms                 — FCP (iOS fallback) (Track: Navigation)
 *   catalyst:page-load|<url>            — native page-load-start → page-load-end (Track: Navigation)
 *   catalyst:cold-start|<ms>ms          — native app cold start duration (Track: Navigation)
 *   catalyst:boot/activity-created      — batch: MainActivity.onCreate (Track: Navigation)
 *   catalyst:boot/webview-constructed   — batch: CustomWebView init{} (Track: Navigation)
 *   catalyst:boot/load-url              — batch: WebView.loadUrl() call (Track: Navigation)
 *   catalyst:boot/page-started          — batch: onPageStarted callback (Track: Navigation)
 *   catalyst:boot/page-finished         — batch: onPageFinished callback (Track: Navigation)
 */

import { TRACK, PREFIX, COLOR } from '../core/constants.js'
import { Session } from '../core/session.js'

export class NavigationCollector {
    constructor(measure, nativeToWeb) {
        this._measure    = measure
        this._nativeToWeb = nativeToWeb ?? ((t) => t)
        this._session    = new Session(PREFIX.SESSION_NAV, measure, TRACK.NAVIGATION)
        this._pendingLcp = null   // { entry, label } — buffered until finalized
        this._lcpFinalized = false
        // Track pending native page-load spans: url → { markName, startWeb }
        this._pendingPageLoads = new Map()
    }

    init() {
        this._session.open()
        this._observeLCP()
        this._observeRouteTransitions()
        this._setupLcpFinalization()
    }

    // Called by other collectors to check if nav is still loading
    get isLoading() {
        return this._session.isOpen
    }

    // ─── LCP ──────────────────────────────────────────────────────────────────

    _observeLCP() {
        const types = PerformanceObserver.supportedEntryTypes ?? []
        const type = types.includes('largest-contentful-paint') ? 'largest-contentful-paint'
            : types.includes('paint') ? 'paint'
            : null
        if (!type) return

        const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (type === 'paint' && entry.name !== 'first-contentful-paint') continue
                const label = type === 'largest-contentful-paint' ? 'lcp' : 'fcp'
                this._pendingLcp = { entry, label }  // overwrite — keep latest candidate
            }
        })
        obs.observe({ type, buffered: true })
    }

    _setupLcpFinalization() {
        // Browser stops updating LCP candidate on first user interaction or page hide
        const finalize = () => {
            this._finalizeLcp()
            document.removeEventListener('pointerdown', finalize)
            document.removeEventListener('keydown', finalize)
        }
        document.addEventListener('pointerdown', finalize)
        document.addEventListener('keydown', finalize)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this._finalizeLcp()
        })
    }

    _finalizeLcp() {
        if (this._lcpFinalized || !this._pendingLcp) return
        this._lcpFinalized = true
        const { entry, label } = this._pendingLcp
        this._pendingLcp = null

        const markName = `${PREFIX[label.toUpperCase()]}:mark`
        performance.mark(markName, { startTime: 0 })
        this._measure.emit(
            `${PREFIX[label.toUpperCase()]}|${Math.round(entry.startTime)}ms`,
            markName,
            entry.startTime,
            {
                renderTime: entry.renderTime ?? null,
                loadTime:   entry.loadTime ?? null,
                simulatorValid: false,
            },
            TRACK.NAVIGATION
        )

        // LCP finalized = page is loaded — close the navigation session
        this._session.close({ simulatorValid: false }, entry.startTime)
    }

    // ─── Route transitions ────────────────────────────────────────────────────
    // Detects SPA route changes via popstate + hashchange.
    // Emits a span from event fire → next rAF (visual settle).
    //
    // Covers:
    //   #7  — if rAF never fires cleanly, transition span shows the gap
    //   #9  — span fires on back but not on some forward routes → missing spans = broken routes
    //   #11 — nav session re-opens; layout-shift collector shows shift after session close

    _observeRouteTransitions() {
        let _fromPath = location.pathname + location.hash

        const onTransition = (e) => {
            const from = _fromPath
            const to   = location.pathname + location.hash
            _fromPath  = to

            const startTime = performance.now()
            const markName  = `${PREFIX.ROUTE_TRANSITION}:start:${Math.round(startTime)}`
            performance.mark(markName, { startTime })

            // Re-open nav session for the SPA route change.
            // LCP only fires once per WebView load — it does not reset on pushState.
            // So we can't wait for LCP to close the session. Instead, close it after
            // the next rAF (visual settle) + a short timeout to catch deferred renders.
            if (!this._session.isOpen) {
                this._lcpFinalized = false
                this._session.open({}, startTime)
                this._setupLcpFinalization()
                // Fallback: if LCP doesn't fire (SPA), close after rAF + 1s
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        if (this._session.isOpen && !this._lcpFinalized) {
                            this._session.close({ simulatorValid: true }, performance.now())
                        }
                    }, 1000)
                })
            }

            requestAnimationFrame(() => {
                const endTime = performance.now()
                this._measure.emit(
                    `${PREFIX.ROUTE_TRANSITION}|${from}→${to}`,
                    markName,
                    endTime,
                    {
                        from,
                        to,
                        type: e.type,   // 'popstate' or 'hashchange'
                        simulatorValid: true,
                    },
                    TRACK.NAVIGATION
                )
            })
        }

        window.addEventListener('popstate',    onTransition)
        window.addEventListener('hashchange',  onTransition)
    }

    // ─── Native page-load events (from CustomWebview.kt) ─────────────────────
    // page-load-start: fired by onPageStarted, carries nativeTime + url
    // page-load-end:   fired by onPageFinished, carries nativeTime + url + durationMs
    // page-load-error: fired by onReceivedError, carries nativeTime + url + errorCode

    onNativeEvent(event) {
        switch (event.type) {
            case 'page-load-start': {
                const startWeb = this._nativeToWeb(event.nativeTime)
                const markName = `${PREFIX.PAGE_LOAD}:start:${Math.round(startWeb)}`
                performance.mark(markName, { startTime: startWeb })
                this._pendingPageLoads.set(event.url, { markName, startWeb })
                break
            }
            case 'page-load-end': {
                const pending = this._pendingPageLoads.get(event.url)
                if (!pending) break
                this._pendingPageLoads.delete(event.url)
                const endWeb  = this._nativeToWeb(event.nativeTime)
                const durMs   = event.durationMs ?? Math.round(endWeb - pending.startWeb)
                const isSlow  = durMs > 2500
                this._measure.emit(
                    `${PREFIX.PAGE_LOAD}|${event.url.split('/').pop() || event.url}`,
                    pending.markName,
                    endWeb,
                    {
                        url:            event.url,
                        durationMs:     durMs,
                        simulatorValid: true,
                    },
                    TRACK.NAVIGATION,
                    isSlow ? 'error' : 'primary'
                )
                break
            }
            case 'page-load-error': {
                const pending = this._pendingPageLoads.get(event.url)
                const startWeb = pending ? pending.startWeb : this._nativeToWeb(event.nativeTime)
                const markName = pending ? pending.markName
                    : `${PREFIX.PAGE_LOAD}:err:${Math.round(startWeb)}`
                if (!pending) performance.mark(markName, { startTime: startWeb })
                this._pendingPageLoads.delete(event.url)
                const errEnd = this._nativeToWeb(event.nativeTime) + 1
                this._measure.emit(
                    `${PREFIX.PAGE_LOAD}/error|${event.errorCode ?? '?'}`,
                    markName,
                    errEnd,
                    {
                        url:            event.url,
                        errorCode:      event.errorCode,
                        description:    event.description ?? '',
                        simulatorValid: true,
                    },
                    TRACK.NAVIGATION,
                    'error'
                )
                break
            }
            case 'cold-start': {
                // emitted by markAppStartComplete() — point-in-time span at page init
                const startWeb = this._nativeToWeb(event.nativeTime)
                const markName = `${PREFIX.COLD_START}:mark`
                performance.mark(markName, { startTime: Math.max(0, startWeb - event.durationMs) })
                this._measure.emit(
                    `${PREFIX.COLD_START}|${event.durationMs}ms`,
                    markName,
                    startWeb,
                    {
                        durationMs:     event.durationMs,
                        simulatorValid: true,
                    },
                    TRACK.NAVIGATION,
                    event.durationMs > 3000 ? 'error' : 'secondary'
                )
                break
            }
        }
    }

    // ─── Batch boot timing events ─────────────────────────────────────────────
    // Emitted from PerfEventBuffer flush after onPageFinished.
    // Each boot-* event is a point-in-time marker on Catalyst > Navigation.

    onBatchEvent(event) {
        if (event.type === 'navigation-back') {
            const t = this._nativeToWeb(event.nativeTime)
            const markName = `catalyst:navigation/back:${Math.round(t)}`
            performance.mark(markName, { startTime: Math.max(0, t) })
            this._measure.emit(
                'catalyst:navigation/back',
                markName,
                Math.max(0, t) + 1,
                { simulatorValid: false },
                TRACK.NAVIGATION,
                COLOR.SECONDARY
            )
            return
        }

        const bootTypeMap = {
            'boot-activity-created':    'activity-created',
            'boot-webview-constructed': 'webview-constructed',
            'boot-load-url':            'load-url',
            'boot-page-started':        'page-started',
            'boot-page-finished':       'page-finished',
        }
        const label = bootTypeMap[event.type]
        if (!label) return

        const t = this._nativeToWeb(event.nativeTime)
        const markName = `catalyst:boot/${label}:${Math.round(t)}`
        performance.mark(markName, { startTime: Math.max(0, t) })
        this._measure.emit(
            `catalyst:boot/${label}`,
            markName,
            Math.max(0, t) + 1,  // point span
            { nativeTime: event.nativeTime, thread: event.thread ?? null, simulatorValid: false },
            TRACK.NAVIGATION,
            COLOR.SECONDARY_LIGHT
        )
    }
}
