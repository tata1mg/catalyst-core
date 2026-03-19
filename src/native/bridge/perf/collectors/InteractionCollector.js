/**
 * InteractionCollector.js
 *
 * Instruments: bugs #6, #8, #13, #17
 *   #6  blank screens              → tap → no paint → LoAF blocked first render
 *                                    detected as: interaction span with no following rAF / LoAF overlap
 *   #8  long press context menu    → pointerdown held > 500ms = native context menu will appear
 *                                    detected as: long-press span so devs see which elements trigger it
 *   #13 cart jank haywire clicks   → interaction timestamps vs render timestamps diverge
 *                                    detected as: tap → paint delta > INTERACTION_SLOW_MS
 *   #17 prescription modal wrong   → event queue backed up: pointerdown fires long after it was queued
 *                                    detected as: slow interaction span overlapping LoAF
 *
 * Spans emitted:
 *   catalyst:session/interaction|<tag>#<id>  — pointerdown → 2s window (Track: Interaction)
 *                                              Parent span that groups all tap-triggered events.
 *                                              detail: sessionId, target, bridgeCalls, fpsDrop
 *   catalyst:interaction|<tag>#<id>          — pointerdown → next rAF (Track: Interaction)
 *                                              detail: responseMs, loafOverlap, target, sessionId
 *   catalyst:long-press|<tag>                — pointerdown held > 500ms (Track: Interaction)
 *                                              detail: target, heldMs
 *
 * Session nesting:
 *   On pointerdown, a 2-second interaction session opens.
 *   BridgeCollector and RenderCollector query activeSessionId to tag their spans.
 *   Session closes after SESSION_WINDOW_MS (2s) or next pointerdown, whichever comes first.
 */

import { TRACK, PREFIX, THRESHOLD } from '../core/constants.js'
import { Session } from '../core/session.js'

const SESSION_WINDOW_MS = 2000

export class InteractionCollector {
    constructor(measure) {
        this._measure        = measure
        this._pendingTaps    = new Map()  // pointerId → { startMark, startTime, target }
        this._session        = new Session(PREFIX.SESSION_INTERACTION, measure, TRACK.INTERACTION)
        this._sessionTimer   = null
        this._sessionId      = null
        this._sessionBridgeCalls = 0
        this._sessionFpsDrop     = false
    }

    // ─── Public API — queried by BridgeCollector + RenderCollector ─────────────

    get activeSessionId() {
        return this._session.isOpen ? this._sessionId : null
    }

    /** Called by index.js to wire up insights notifications. */
    setInsightsSource(fn) {
        this._notifyInsights = fn
    }

    /** Called by RenderCollector when an fps-drop-episode fires. */
    onFpsDrop() {
        if (this._session.isOpen) {
            this._sessionFpsDrop = true
            this._session.set('fpsDrop', true)
        }
    }

    /** Called by BridgeCollector when a bridge-call span completes. */
    onBridgeCall() {
        if (this._session.isOpen) {
            this._sessionBridgeCalls++
            this._session.set('bridgeCalls', this._sessionBridgeCalls)
        }
    }

    init() {
        document.addEventListener('pointerdown', this._onPointerDown.bind(this), { passive: true })
        document.addEventListener('pointerup',   this._onPointerUp.bind(this),   { passive: true })
        document.addEventListener('pointercancel', (e) => this._pendingTaps.delete(e.pointerId), { passive: true })
    }

    _openSession(target, startTime) {
        // Close any existing session immediately — new tap = new session
        this._closeSession()

        this._sessionId          = `${Math.round(startTime)}`
        this._sessionBridgeCalls = 0
        this._sessionFpsDrop     = false

        this._session.open({ target, sessionId: this._sessionId, bridgeCalls: 0, fpsDrop: false }, startTime)

        // Auto-close after 2s
        this._sessionTimer = setTimeout(() => this._closeSession(), SESSION_WINDOW_MS)
    }

    _closeSession() {
        if (this._sessionTimer) {
            clearTimeout(this._sessionTimer)
            this._sessionTimer = null
        }
        if (this._session.isOpen) {
            this._session.close({
                sessionId:   this._sessionId,
                bridgeCalls: this._sessionBridgeCalls,
                fpsDrop:     this._sessionFpsDrop,
            }, null, this._sessionFpsDrop ? 'error' : 'secondary')
        }
        this._sessionId = null
    }

    _onPointerDown(e) {
        const startTime  = performance.now()
        const target     = this._describeTarget(e.target)
        const startMark  = `${PREFIX.INTERACTION}:${e.pointerId}:start`
        performance.mark(startMark, { startTime })

        // Open interaction session — groups all events triggered by this tap
        this._openSession(target, startTime)
        const sessionId = this._sessionId

        // Long-press detection timer
        const longPressTimer = setTimeout(() => {
            this._emitLongPress(e.pointerId, target, startTime)
        }, THRESHOLD.LONG_PRESS_MS)

        this._pendingTaps.set(e.pointerId, { startMark, startTime, target, longPressTimer })

        // Measure tap → next paint (interaction responsiveness)
        requestAnimationFrame(() => {
            const endTime = performance.now()
            const tap     = this._pendingTaps.get(e.pointerId)
            if (!tap) return  // pointerup or cancel already cleaned up

            const responseMs = Math.round(endTime - startTime)
            if (responseMs > THRESHOLD.INTERACTION_SLOW_MS) {
                this._notifyInsights?.({ target, responseMs })
            }

            this._measure.emit(
                `${PREFIX.INTERACTION}|${target}`,
                startMark,
                endTime,
                {
                    responseMs,
                    loafOverlap: this._measure.overlapsLoaf(startTime, endTime),
                    target,
                    sessionId,
                    simulatorValid: false,
                },
                TRACK.INTERACTION
            )
        })
    }

    _onPointerUp(e) {
        const tap = this._pendingTaps.get(e.pointerId)
        if (tap) {
            clearTimeout(tap.longPressTimer)
            this._pendingTaps.delete(e.pointerId)
        }
    }

    _emitLongPress(pointerId, target, startTime) {
        const tap = this._pendingTaps.get(pointerId)
        if (!tap) return

        const endTime  = performance.now()
        const heldMs   = Math.round(endTime - startTime)
        const markName = `${PREFIX.LONG_PRESS}:${Math.round(startTime)}`
        performance.mark(markName, { startTime })

        this._measure.emit(
            `${PREFIX.LONG_PRESS}|${target}`,
            markName,
            endTime,
            {
                target,
                heldMs,
                sessionId: this._sessionId,
                simulatorValid: true,
            },
            TRACK.INTERACTION
        )
    }

    _describeTarget(el) {
        if (!el) return 'unknown'
        const tag = el.tagName?.toLowerCase() ?? 'unknown'
        const id  = el.id   ? `#${el.id}`          : ''
        const cls = el.classList?.length
            ? `.${[...el.classList].slice(0, 2).join('.')}`
            : ''
        return `${tag}${id}${cls}`.slice(0, 40)
    }
}
