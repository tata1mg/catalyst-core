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

import { TRACK, PREFIX, COLOR } from '../core/constants.js'

export class ApiCollector {
    constructor(measure, nativeToWeb) {
        this._measure     = measure
        this._nativeToWeb = nativeToWeb
    }

    init() {
        // No web-side observers — all events come from native buffer drain
    }

    onBatchEvent(event) {
        if (event.type !== 'api-call') return
        const { method, callId, nativeStartMs, nativeEndMs, durationMs, thread } = event

        const startTime = this._nativeToWeb(nativeStartMs)
        const endTime   = this._nativeToWeb(nativeEndMs)

        const color = durationMs > 200 ? COLOR.ERROR
            : durationMs > 50  ? COLOR.SECONDARY
            : COLOR.PRIMARY_DARK

        const measureName = `${PREFIX.BRIDGE_CALL}/api|${method}`
        const startMark   = `${measureName}:start:${Math.round(startTime)}`
        performance.mark(startMark, { startTime })
        this._measure.emit(
            measureName,
            startMark,
            endTime,
            { method, durationMs, callId, thread: thread ?? null, simulatorValid: false },
            TRACK.NATIVE_API,
            color
        )
    }
}
