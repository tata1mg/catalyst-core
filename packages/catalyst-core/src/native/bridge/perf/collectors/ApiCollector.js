/**
 * ApiCollector.js
 *
 * Instruments native API call timing — how long each @JavascriptInterface
 * method takes from JS invocation to native callback dispatch.
 *
 * Native events received (via __catalystPerfBatch drain):
 *   api-call { callId, method, nativeStartMs, nativeEndMs, durationMs, thread }
 *
 * Spans emitted (one per call, on Catalyst > Native API track):
 *   catalyst:api/<method>  — nativeStart → nativeEnd
 *                            color: primary-dark (<50ms), secondary (<200ms), error (>200ms)
 *   properties: method, durationMs, callId, thread, simulatorValid: false
 *
 * Reading the track:
 *   Blue  = fast native call (<50ms)   — expected for sync APIs (getDeviceInfo, haptic)
 *   Grey  = medium native call (<200ms) — expected for async APIs with quick resolution
 *   Red   = slow native call (>200ms)  — investigate (googleSignIn, camera, file picker)
 */

import { TRACK, PREFIX, COLOR } from "../core/constants.js"

export class ApiCollector {
    constructor(measure, nativeToWeb) {
        this._measure = measure
        this._nativeToWeb = nativeToWeb
    }

    init() {
        // No web-side observers — all events come from native buffer drain
    }

    /** Called by index.js to feed the normalized perf store. */
    setWaterfallSource(fn) {
        this._notifyWaterfall = fn
    }

    setBridgeSource(fn) {
        this._getBridge = fn
    }

    setInteractionSource(fn) {
        this._getInteraction = fn
    }

    onBatchEvent(event) {
        if (event.type !== "api-call") return
        const { method, callId, nativeStartMs, nativeEndMs, durationMs, thread } = event

        const startTime = this._nativeToWeb(nativeStartMs)
        const endTime = this._nativeToWeb(nativeEndMs)
        const interactionId =
            this._getBridge?.()?.interactionIdForCall(callId) ??
            this._getInteraction?.()?.interactionIdForRange(startTime, endTime) ??
            null

        const color = durationMs > 200 ? COLOR.ERROR : durationMs > 50 ? COLOR.SECONDARY : COLOR.PRIMARY_DARK

        const startMark = `${PREFIX.BRIDGE_CALL}:api:${method}:start:${Math.round(startTime)}`
        performance.mark(startMark, { startTime })
        this._notifyWaterfall?.({
            method,
            durationMs,
            callId,
            thread: thread ?? null,
            startTime,
            endTime,
            sessionId: interactionId,
            parentOperation: `Bridge: ${method}`,
        })
        this._measure.emit(
            `${interactionId ? `[${interactionId}] ` : ""}Native API: ${method} - ${durationMs}ms`,
            startMark,
            endTime,
            {
                interactionId,
                parentOperation: `Bridge: ${method}`,
                method,
                durationMs,
                callId,
                thread: thread ?? null,
                simulatorValid: false,
            },
            TRACK.NATIVE_API,
            color
        )
    }
}
