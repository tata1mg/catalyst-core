/**
 * ThreadCollector.js
 *
 * Instruments: thread visibility gap during cache serving.
 *
 * Problem: when shouldInterceptRequest serves from cache it calls
 * disableHardwareAcceleration() / enableHardwareAcceleration() on the WebView.
 * This creates a software-render window that is invisible in the Render track
 * because it happens on a bg thread and neither the thread name nor the
 * hw-accel state appears in any existing span.
 *
 * Native events received (via index.js router):
 *   hw-accel-change  { state: 'off'|'on', trigger: 'cache-serve'|'cleanup',
 *                      thread, nativeTime }
 *
 * Spans emitted (on Render track):
 *   catalyst:hw-accel/off  — software-render window open (error = bad, overlaps frames)
 *   catalyst:hw-accel/on   — hardware acceleration restored (primary)
 *
 * Overlap detection:
 *   If a LoAF overlaps a software-render window → notifyInsights so
 *   InsightsCollector can fire an 'hw-accel-during-frame' critical insight.
 */

import { TRACK, PREFIX, COLOR } from '../core/constants.js'

export class ThreadCollector {
    constructor(measure, nativeToWeb) {
        this._measure     = measure
        this._nativeToWeb = nativeToWeb

        // Track open software-render windows: { startMark, startTime, thread }
        this._openWindow = null

        this._notifyInsights = null
    }

    /** Called by index.js to wire up insights notifications. */
    setInsightsSource(fn) {
        this._notifyInsights = fn
    }

    init() {
        // No web-side observers — all events come from native via onNativeEvent()
    }

    onNativeEvent(event) {
        if (event.type !== 'hw-accel-change') return

        const { state, trigger, thread, nativeTime } = event
        const webTime = nativeTime != null ? this._nativeToWeb(nativeTime) : performance.now()

        if (state === 'off') {
            // Software-render window opens — record start, wait for 'on' to close span
            const markName = `${PREFIX.HW_ACCEL}/off:start:${Math.round(webTime)}`
            performance.mark(markName, { startTime: webTime })
            this._openWindow = { startMark: markName, startTime: webTime, thread: thread ?? null, trigger: trigger ?? null }

        } else if (state === 'on') {
            const endTime = webTime

            if (this._openWindow) {
                const { startMark, startTime, thread: offThread, trigger: offTrigger } = this._openWindow
                this._openWindow = null

                const loafOverlap = this._measure.overlapsLoaf(startTime, endTime)

                this._measure.emit(
                    `${PREFIX.HW_ACCEL}/sw-render-window|${offTrigger ?? 'unknown'}`,
                    startMark,
                    endTime,
                    {
                        trigger:       offTrigger ?? null,
                        thread:        offThread ?? null,
                        loafOverlap,
                        simulatorValid: false,
                    },
                    TRACK.RENDER,
                    loafOverlap ? COLOR.ERROR : COLOR.SECONDARY_DARK
                )

                if (loafOverlap) {
                    this._notifyInsights?.({
                        durationMs: endTime - startTime,
                        thread:     offThread,
                        trigger:    offTrigger,
                    })
                }
            }

            // Emit a point-in-time marker for hw-accel restored
            const onMark = `${PREFIX.HW_ACCEL}/on:${Math.round(endTime)}`
            performance.mark(onMark, { startTime: endTime })
            this._measure.emit(
                `${PREFIX.HW_ACCEL}/restored`,
                onMark,
                endTime + 1,
                {
                    trigger:        trigger ?? null,
                    thread:         thread ?? null,
                    simulatorValid: false,
                },
                TRACK.RENDER,
                COLOR.SECONDARY
            )
        }
    }
}
