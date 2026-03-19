/**
 * KeyboardCollector.js
 *
 * Instruments: bugs #3, #12
 *   #3  keyboard sticky scroll   → keyboard-show → viewport-resize → scroll fires during session
 *                                   if sticky element recalcs during this window it causes thrash
 *   #12 search input no auto-focus → keyboard-show event should fire after route transition to search
 *                                    if it doesn't, the native WebView suppressed programmatic focus
 *
 * Native events received (via index.js router):
 *   keyboard-show  { nativeTime, keyboardHeight }
 *   keyboard-hide  { nativeTime }
 *
 * Spans emitted:
 *   catalyst:session/keyboard   — keyboard-show → viewport settled (Track: Keyboard)
 *                                 detail: keyboardHeight, viewportDelta, hadScrollDuringSession
 *   catalyst:viewport-resize    — visualViewport resize → next rAF (Track: Keyboard)
 *                                 detail: deltaHeight
 */

import { TRACK, PREFIX, THRESHOLD } from '../core/constants.js'
import { Session } from '../core/session.js'

export class KeyboardCollector {
    constructor(measure, nativeToWeb) {
        this._measure      = measure
        this._nativeToWeb  = nativeToWeb
        this._session      = new Session(PREFIX.SESSION_KEYBOARD, measure, TRACK.INPUT)
    }

    init() {
        this._observeVisualViewport()
    }

    // ─── Native event handlers ────────────────────────────────────────────────

    onKeyboardShow(event) {
        const webNow = this._nativeToWeb(event.nativeTime)
        this._session.open({ keyboardHeight: event.keyboardHeight, hadScroll: false }, webNow)
    }

    onKeyboardHide(event) {
        const webNow = this._nativeToWeb(event.nativeTime)
        if (this._session.isOpen) {
            this._closeSession(webNow)
        }
        // Emit a point mark so keyboard-hide is visible on the timeline
        const hideMark = `catalyst:keyboard-hide:${Math.round(webNow)}`
        performance.mark(hideMark, { startTime: webNow })
    }

    // Called by ScrollCollector (via index.js) if scroll fires while keyboard open
    onScrollDuringKeyboard() {
        if (this._session.isOpen) {
            this._session.set('hadScroll', true)
        }
    }

    // ─── Viewport resize ──────────────────────────────────────────────────────
    // Fires when keyboard pushes/pulls the viewport.
    // Also closes the keyboard session — viewport settling = keyboard done.

    _observeVisualViewport() {
        if (!window.visualViewport) return
        let lastHeight = window.visualViewport.height

        window.visualViewport.addEventListener('resize', () => {
            const now       = performance.now()
            const newHeight = window.visualViewport.height
            const delta     = Math.abs(newHeight - lastHeight)
            lastHeight      = newHeight

            if (delta < THRESHOLD.VIEWPORT_MIN_DELTA) return

            const markName = `${PREFIX.VIEWPORT_RESIZE}:start:${Math.round(now)}`
            performance.mark(markName, { startTime: now })

            requestAnimationFrame(() => {
                const endTime = performance.now()
                this._measure.emit(
                    PREFIX.VIEWPORT_RESIZE,
                    markName,
                    endTime,
                    { deltaHeight: Math.round(delta), simulatorValid: true },
                    TRACK.INPUT
                )
                if (this._session.isOpen) {
                    this._closeSession(endTime)
                }
            })
        })
    }

    _closeSession(endTime) {
        this._session.close({
            keyboardHeight:       this._session.get('keyboardHeight'),
            hadScrollDuringSession: this._session.get('hadScroll'),
            simulatorValid:       false,
        }, endTime)
    }
}
