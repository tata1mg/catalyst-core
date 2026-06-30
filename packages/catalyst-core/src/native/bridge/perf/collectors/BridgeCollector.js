/**
 * BridgeCollector.js
 *
 * Instruments: bugs #4, #5, #17
 *   #4  file upload not working             → bridge call fires, no response → timeout span
 *   #5  delivery address widget missing     → bridge call returns null payload or wrong shape
 *   #17 clicks haywire / modal opens wrong  → bridge call response arrives late (event queue backed up)
 *                                             → response roundTrip > BRIDGE_SLOW_MS during cart jank
 *
 * How it works:
 *   WebBridge.js wraps every native call. At call site:
 *     window.__catalystPerfEvent({ type: 'bridge-call-start', callId, method, nativeTime })
 *   At response:
 *     window.__catalystPerfEvent({ type: 'bridge-call-end', callId, method, nativeTime, ok, payloadSize })
 *
 *   BridgeCollector matches start↔end by callId and emits the round-trip span.
 *   Calls with no response within BRIDGE_TIMEOUT_MS are emitted as timedOut=true.
 *
 * Spans emitted:
 *   catalyst:bridge-call|<method>  — call start → response (Track: Bridge)
 *                                    detail: method, roundTripMs, ok, payloadSize, timedOut
 *
 * TODO (Option B):
 *   When web app opts in via window.catalyst.markBridgeCall(), emit precise hook-lifecycle
 *   spans for the component that triggered the bridge call.
 */

import { TRACK, PREFIX, THRESHOLD } from "../core/constants.js"

const MAX_CALL_CORRELATIONS = 500

export class BridgeCollector {
    constructor(measure, nativeToWeb) {
        this._measure = measure
        this._nativeToWeb = nativeToWeb
        this._getInteraction = null // set by index.js after construction
        // Pending calls: callId → { startMark, startTime, method, timeoutHandle }
        this._pending = new Map()
        this._callInteractions = new Map()
    }

    /** Called by index.js to wire up interaction session context. */
    setInteractionSource(fn) {
        this._getInteraction = fn
    }

    /** Called by index.js to wire up insights notifications. */
    setInsightsSource(fn) {
        this._notifyInsights = fn
    }

    /** Called by index.js to feed the normalized perf store. */
    setWaterfallSource(fn) {
        this._notifyWaterfall = fn
    }

    interactionIdForCall(callId) {
        return this._callInteractions.get(callId) ?? null
    }

    init() {
        // No web-side observers — all events come from native via onNativeEvent()
    }

    onNativeEvent(event) {
        switch (event.type) {
            case "bridge-call-start":
                this._onCallStart(event)
                break
            case "bridge-call-end":
                this._onCallEnd(event)
                break
        }
    }

    _onCallStart(event) {
        const { callId, method, nativeTime } = event
        const startTime = this._nativeToWeb(nativeTime)
        const startMark = `${PREFIX.BRIDGE_CALL}:${callId}:start`
        const interactionId = this._getInteraction?.()?.activeInteractionId ?? null
        if (interactionId) {
            this._callInteractions.set(callId, interactionId)
            if (this._callInteractions.size > MAX_CALL_CORRELATIONS) {
                this._callInteractions.delete(this._callInteractions.keys().next().value)
            }
        }

        performance.mark(startMark, { startTime })

        // Set timeout — if no end arrives, emit a timed-out span
        const timeoutHandle = setTimeout(() => {
            this._emitSpan(
                callId,
                method,
                startMark,
                startTime,
                {
                    ok: false,
                    payloadSize: null,
                    timedOut: true,
                },
                null,
                interactionId
            )
        }, THRESHOLD.BRIDGE_TIMEOUT_MS)

        this._pending.set(callId, { startMark, startTime, method, timeoutHandle, interactionId })
    }

    _onCallEnd(event) {
        const { callId, method, nativeTime, ok, payloadSize } = event
        const pending = this._pending.get(callId)
        if (!pending) return

        clearTimeout(pending.timeoutHandle)
        const endTime = this._nativeToWeb(nativeTime)

        this._emitSpan(
            callId,
            method ?? pending.method,
            pending.startMark,
            pending.startTime,
            {
                ok: ok ?? true,
                payloadSize: payloadSize ?? null,
                timedOut: false,
            },
            endTime,
            pending.interactionId
        )
    }

    _emitSpan(callId, method, startMark, startTime, detail, endTime = null, interactionId = null) {
        this._pending.delete(callId)
        const end = endTime ?? performance.now()

        const roundTripMs = Math.round(end - startTime)
        if (interactionId) this._getInteraction?.()?.onBridgeCall()
        this._notifyInsights?.({
            method,
            roundTripMs,
            timedOut: detail.timedOut ?? false,
            startTime,
            endTime: end,
            callId,
            interactionId,
        })
        this._notifyWaterfall?.({
            method,
            callId,
            durationMs: roundTripMs,
            timedOut: detail.timedOut ?? false,
            ok: detail.ok ?? true,
            startTime,
            endTime: end,
            sessionId: interactionId,
        })

        this._measure.emit(
            `${interactionId ? `[${interactionId}] ` : ""}Bridge: ${method} - ${roundTripMs}ms`,
            startMark,
            end,
            {
                interactionId,
                method,
                roundTripMs,
                callId,
                ...detail,
                simulatorValid: false,
            },
            TRACK.BRIDGE
        )
    }
}
