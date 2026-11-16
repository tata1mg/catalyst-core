"use strict"

const { GUTTER, SPINNER_FRAMES, t, isInteractive, step } = require("./theme.js")

const FRAME_MS = 120

// Carriage return + erase-line. Built rather than written as a literal so no
// raw control byte sits in the source, where editors and diffs mangle it.
const CLEAR_LINE = `\r${String.fromCharCode(27)}[2K`

// Every spinner currently animating, so code that has no handle on one -- a
// config prompt deep in the native setup -- can still stand them all down.
// A prompt written under a live spinner is erased by the next frame, which
// makes a question look like a hang.
const live = new Set()

/**
 * A single-line progress indicator that collapses into its own result.
 *
 * Deliberately one line and no more: it owns exactly the row it is drawn on,
 * so anything printed before it is untouched and anything after starts on a
 * fresh row. That is what lets streamed child output and the spinner coexist
 * without the cursor-math problems a multi-line region creates.
 *
 * Non-interactive (pipe, CI) prints a plain start line and a plain result
 * line: no animation, no escape codes, and every state still recorded.
 */
class Spinner {
    constructor(stream = process.stdout) {
        this.stream = stream
        this.timer = null
        this.frame = 0
        this.label = ""
        this.startedAt = 0
        this.active = false
        this.interactive = isInteractive(stream)
    }

    start(label) {
        // Starting twice without an intervening stop would orphan the first
        // interval, leaving two timers writing to the same row forever.
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }

        this.label = label
        this.startedAt = Date.now()
        this.active = true
        live.add(this)

        if (!this.interactive) {
            this.stream.write(`${GUTTER}${t.dim("·")} ${label}\n`)
            return this
        }

        this.frame = 0
        this.render()
        this.timer = setInterval(() => {
            this.frame = (this.frame + 1) % SPINNER_FRAMES.length
            this.render()
        }, FRAME_MS)
        // Never hold the process open for an animation.
        if (this.timer.unref) this.timer.unref()
        return this
    }

    /** Change the text without resetting the elapsed timer. */
    update(label) {
        this.label = label
        if (this.interactive && this.active) this.render()
    }

    render() {
        this.stream.write(`${CLEAR_LINE}${GUTTER}${t.accent(SPINNER_FRAMES[this.frame])} ${this.label}`)
    }

    /** Replace the live line with its final state. */
    stop(state = "done", label = this.label) {
        if (!this.active) return
        this.active = false
        live.delete(this)

        const elapsed = Date.now() - this.startedAt

        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }

        if (this.interactive) {
            // Erase the animated line, then write the settled one in its place.
            this.stream.write(CLEAR_LINE)
        }

        this.stream.write(`${step(label, elapsed, state)}\n`)
    }

    /**
     * Stand the animation down so something else can write, without ending the
     * step. Used when a child process streams output beneath a running step.
     */
    pause() {
        if (!this.interactive || !this.active) return
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
        // Erase the live row entirely and leave the cursor on it. Whatever
        // prints next takes that row, and resume() redraws below. Leaving the
        // label behind here would strand a second copy of the step, which then
        // settles into its own duplicate line.
        this.stream.write(CLEAR_LINE)
    }

    resume() {
        if (!this.interactive || !this.active || this.timer) return
        this.render()
        this.timer = setInterval(() => {
            this.frame = (this.frame + 1) % SPINNER_FRAMES.length
            this.render()
        }, FRAME_MS)
        if (this.timer.unref) this.timer.unref()
    }
}

/**
 * Stand every live spinner down while `fn` writes to or reads from the
 * terminal, then bring them back -- on the failure path too.
 */
async function withSpinnersPaused(fn) {
    const paused = [...live]
    for (const spinner of paused) spinner.pause()
    try {
        return await fn()
    } finally {
        for (const spinner of paused) spinner.resume()
    }
}

module.exports = { Spinner, withSpinnersPaused }
