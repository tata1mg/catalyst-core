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
 *   catalyst:session/interaction|<tag>#<id>  — currently disabled; preserved below as the
 *                                              old 2s grouping window for future re-enable.
 *   catalyst:interaction|<tag>#<id>          — pointerdown → next rAF (Track: Interaction)
 *                                              detail: responseMs, loafOverlap, target, sessionId
 *   catalyst:long-press|<tag>                — pointerdown held > 500ms (Track: Interaction)
 *                                              detail: target, heldMs
 *
 * Correlation:
 *   A lightweight interaction ID remains active from pointerdown to the next frame.
 *   Related work is tagged without emitting a parent session track.
 *
 * Disabled session nesting:
 *   On pointerdown, a 2-second interaction session opens.
 *   BridgeCollector and RenderCollector query activeSessionId to tag their spans.
 *   Session closes after SESSION_WINDOW_MS (2s) or next pointerdown, whichever comes first.
 */

import { TRACK, PREFIX, THRESHOLD } from "../core/constants.js"
import { Session } from "../core/session.js"

const SESSION_WINDOW_MS = 2000
const MAX_RECENT_INTERACTIONS = 50

export class InteractionCollector {
    constructor(measure) {
        this._measure = measure
        this._pendingTaps = new Map() // pointerId → { startMark, startTime, target }
        this._session = new Session(PREFIX.SESSION_INTERACTION, measure, TRACK.INTERACTION)
        this._sessionTimer = null
        this._sessionId = null
        this._sessionBridgeCalls = 0
        this._sessionNetworkCalls = 0
        this._sessionFpsDrop = false
        this._activeInteraction = null
        this._recentInteractions = []
        this._interactionSeq = 0
    }

    // ─── Public API — queried by BridgeCollector + RenderCollector ─────────────

    get activeInteractionId() {
        return this._activeInteraction?.id ?? null
    }

    interactionIdForRange(startTime, endTime = startTime) {
        const interactions = this._activeInteraction
            ? [...this._recentInteractions, this._activeInteraction]
            : this._recentInteractions
        return (
            interactions
                .slice()
                .reverse()
                .find(
                    (interaction) =>
                        startTime <= (interaction.endTime ?? performance.now()) &&
                        endTime >= interaction.startTime
                )?.id ?? null
        )
    }

    /** Called by index.js to wire up insights notifications. */
    setInsightsSource(fn) {
        this._notifyInsights = fn
    }

    /** Called by index.js to feed the normalized perf store. */
    setWaterfallSource(fn) {
        this._notifyWaterfall = fn
    }

    /** Called by RenderCollector when an fps-drop-episode fires. */
    onFpsDrop() {
        if (this._session.isOpen) {
            this._sessionFpsDrop = true
            this._session.set("fpsDrop", true)
        }
    }

    /** Called by BridgeCollector when a bridge-call span completes. */
    onBridgeCall() {
        if (this._session.isOpen) {
            this._sessionBridgeCalls++
            this._session.set("bridgeCalls", this._sessionBridgeCalls)
        }
    }

    /** Called by NetworkTimingCollector when a fetch/XHR starts during an interaction. */
    onNetworkCall() {
        if (this._session.isOpen) {
            this._sessionNetworkCalls++
            this._session.set("networkCalls", this._sessionNetworkCalls)
        }
    }

    init() {
        document.addEventListener("pointerdown", this._onPointerDown.bind(this), { passive: true })
        document.addEventListener("pointerup", this._onPointerUp.bind(this), { passive: true })
        document.addEventListener("pointercancel", this._onPointerCancel.bind(this), { passive: true })
    }

    _openSession(target, startTime) {
        // Close any existing session immediately — new tap = new session
        this._closeSession()

        this._sessionId = `${Math.round(startTime)}`
        this._sessionBridgeCalls = 0
        this._sessionNetworkCalls = 0
        this._sessionFpsDrop = false

        this._session.open(
            {
                target,
                sessionId: this._sessionId,
                bridgeCalls: 0,
                networkCalls: 0,
                fpsDrop: false,
            },
            startTime
        )
        this._notifyWaterfall?.({ phase: "start", target, sessionId: this._sessionId, startTime })

        // Auto-close after 2s
        this._sessionTimer = setTimeout(() => this._closeSession(), SESSION_WINDOW_MS)
    }

    _closeSession() {
        if (this._sessionTimer) {
            clearTimeout(this._sessionTimer)
            this._sessionTimer = null
        }
        if (this._session.isOpen) {
            const target = this._session.get("target")
            const startTime = this._session.startTime
            const endTime = performance.now()
            this._session.close(
                {
                    sessionId: this._sessionId,
                    bridgeCalls: this._sessionBridgeCalls,
                    networkCalls: this._sessionNetworkCalls,
                    fpsDrop: this._sessionFpsDrop,
                },
                endTime,
                this._sessionFpsDrop ? "error" : "secondary"
            )
            this._notifyWaterfall?.({
                phase: "end",
                target,
                sessionId: this._sessionId,
                bridgeCalls: this._sessionBridgeCalls,
                networkCalls: this._sessionNetworkCalls,
                fpsDrop: this._sessionFpsDrop,
                startTime,
                endTime,
                durationMs: Math.round(endTime - startTime),
            })
        }
        this._sessionId = null
    }

    _onPointerDown(e) {
        const startTime = performance.now()
        const target = this._describeTarget(e.target)
        const startMark = `${PREFIX.INTERACTION}:${e.pointerId}:start`
        const interactionId = `Tap #${++this._interactionSeq}`
        performance.mark(startMark, { startTime })
        this._activeInteraction = { id: interactionId, startTime, endTime: null }
        this._measure.marker(`${interactionId}: ${target}`, startTime, { interactionId, target }, "secondary")

        // The old 2s parent session
        // this._openSession(target, startTime)

        // Long-press detection timer
        const longPressTimer = setTimeout(() => {
            this._emitLongPress(e.pointerId, target, startTime)
        }, THRESHOLD.LONG_PRESS_MS)

        this._pendingTaps.set(e.pointerId, {
            startMark,
            startTime,
            target,
            interactionId,
            longPressTimer,
        })

        // Measure tap → next paint (interaction responsiveness)
        requestAnimationFrame(() => {
            const endTime = performance.now()
            const tap = this._pendingTaps.get(e.pointerId)
            if (!tap) return
            tap.frameComplete = true
            if (tap.released) this._pendingTaps.delete(e.pointerId)
            this._rememberInteraction(interactionId, startTime, endTime)

            const responseMs = Math.round(endTime - startTime)
            if (responseMs > THRESHOLD.INTERACTION_SLOW_MS) {
                this._notifyInsights?.({ target, responseMs, startTime, endTime, interactionId })
            }

            this._measure.emit(
                `${interactionId}: ${target} - ${responseMs}ms`,
                startMark,
                endTime,
                {
                    responseMs,
                    loafOverlap: this._measure.overlapsLoaf(startTime, endTime),
                    target,
                    interactionId,
                    simulatorValid: false,
                },
                TRACK.INTERACTION
            )

            this._notifyWaterfall?.({
                phase: "end",
                target,
                sessionId: interactionId,
                bridgeCalls: 0,
                networkCalls: 0,
                fpsDrop: false,
                startTime,
                endTime,
                durationMs: responseMs,
                responseMs,
                shortInteraction: true,
            })
        })
    }

    _onPointerUp(e) {
        const tap = this._pendingTaps.get(e.pointerId)
        if (tap) {
            clearTimeout(tap.longPressTimer)
            tap.released = true
            if (tap.frameComplete) this._pendingTaps.delete(e.pointerId)
        }
    }

    _onPointerCancel(e) {
        const tap = this._pendingTaps.get(e.pointerId)
        if (!tap) return
        clearTimeout(tap.longPressTimer)
        this._pendingTaps.delete(e.pointerId)
        if (this._activeInteraction?.id === tap.interactionId) this._activeInteraction = null
    }

    _rememberInteraction(id, startTime, endTime) {
        this._recentInteractions.push({ id, startTime, endTime })
        if (this._recentInteractions.length > MAX_RECENT_INTERACTIONS) {
            this._recentInteractions.shift()
        }
        if (this._activeInteraction?.id === id) this._activeInteraction = null
    }

    _emitLongPress(pointerId, target, startTime) {
        const tap = this._pendingTaps.get(pointerId)
        if (!tap) return

        const endTime = performance.now()
        const heldMs = Math.round(endTime - startTime)
        const markName = `${PREFIX.LONG_PRESS}:${Math.round(startTime)}`
        performance.mark(markName, { startTime })

        this._measure.emit(
            `${tap.interactionId}: Long press ${target} - ${heldMs}ms`,
            markName,
            endTime,
            {
                target,
                heldMs,
                interactionId: tap.interactionId,
                simulatorValid: true,
            },
            TRACK.INTERACTION,
            "tertiary"
        )
    }

    _describeTarget(el) {
        if (!el) return "unknown"
        const tag = el.tagName?.toLowerCase() ?? "unknown"
        const id = el.id ? `#${el.id}` : ""
        const cls = el.classList?.length ? `.${[...el.classList].slice(0, 2).join(".")}` : ""
        return `${tag}${id}${cls}`.slice(0, 40)
    }
}
