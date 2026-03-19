/**
 * session.js
 *
 * Reusable open/close session pattern.
 * A session is a named span that stays open until explicitly closed.
 *
 * Usage:
 *   const session = new Session('catalyst:session/scroll', measure, TRACK.SCROLL)
 *   session.open({ loafCount: 0 })
 *   session.close({ loafCount: 3, janky: true })
 *
 * The session owns its own start mark so callers don't track mark names.
 */

export class Session {
    /**
     * @param {string}  name    - base measure name (catalyst:session/...)
     * @param {Measure} measure - shared Measure instance
     * @param {string}  track   - Chrome DevTools track name
     */
    constructor(name, measure, track) {
        this._name    = name
        this._measure = measure
        this._track   = track
        this._state   = null  // { startMark, startTime, ...extra } | null
    }

    get isOpen() {
        return this._state !== null
    }

    get startTime() {
        return this._state?.startTime ?? null
    }

    /**
     * Open the session.
     * @param {object} extra - any fields to carry in state (e.g. loafCount)
     * @param {number} [atTime] - override start time (default: performance.now())
     */
    open(extra = {}, atTime = null) {
        if (this._state) return  // already open — ignore double-open
        const startTime = atTime ?? performance.now()
        const startMark = `${this._name}:start:${Math.round(startTime)}`
        performance.mark(startMark, { startTime })
        this._state = { startMark, startTime, ...extra }
    }

    /**
     * Close the session and emit the measure.
     * @param {object} detail - fields added to properties[] in DevTools
     * @param {number} [atTime] - override end time (default: performance.now())
     * @param {string} [color]  - override color
     */
    close(detail = {}, atTime = null, color = null) {
        if (!this._state) return
        const { startMark, startTime } = this._state
        const endTime = atTime ?? performance.now()
        this._state = null
        this._measure.emit(this._name, startMark, endTime, {
            duration: Math.round(endTime - startTime),
            ...detail,
        }, this._track, color)
    }

    /**
     * Read a value stored in session state (e.g. loafCount).
     */
    get(key) {
        return this._state?.[key]
    }

    /**
     * Update a value in session state without closing.
     */
    set(key, value) {
        if (this._state) this._state[key] = value
    }

    /**
     * Increment a numeric counter in session state.
     */
    increment(key) {
        if (this._state) this._state[key] = (this._state[key] ?? 0) + 1
    }
}
