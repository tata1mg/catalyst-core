"use strict"

const { GUTTER, glyph, t, ANSI } = require("./theme.js")

// Fences the dev server writes around its banner block, so the wrapper can
// forward those lines verbatim rather than guessing from their text. Colour
// codes made text-matching unreliable. Chosen to be inert if they ever reach
// a terminal unstripped.
const BANNER_START = "\u0000catalyst:banner:start"
const BANNER_END = "\u0000catalyst:banner:end"
// The server knows which command comes next, but not whether notices will
// land under the banner. It hands the line over fenced and the wrapper prints
// it last, so the one actionable line is never buried under advisories.
const NEXT_STEP = "\u0000catalyst:next:"

/**
 * Shape the dev server's own output so `catalyst start` reads as one thing.
 *
 * The server is a child process that prints in three unrelated voices: Node's
 * multi-line process warnings, Vite's timestamped notices, and our own banner.
 * Left alone they interleave and the banner reads as an afterthought. This
 * classifies each line so the command can present them consistently.
 */

/**
 * Node process warnings arrive as a block: a `(node:123) [CODE] Warning: ...`
 * line, then continuation lines, then a `(Use \`node --trace-warnings ...\`)`
 * footer. They are advisory and almost never actionable mid-session, so the
 * block collapses to a single line.
 */
const WARNING_START = /^\(node:\d+\)\s*(?:\[([A-Z_]+)\]\s*)?Warning:\s*(.*)$/
const WARNING_FOOTER = /^\(Use `node --trace-warnings/

// Vite prefixes its notices with a wall-clock time and a channel, e.g.
// "8:00:53 pm [vite] (client) Re-optimizing dependencies...". The timestamp is
// noise in a session that just started; the message is worth keeping.
const VITE_NOTICE = /^\d{1,2}:\d{2}:\d{2}\s*(?:am|pm)?\s*\[vite\]\s*(?:\(([^)]+)\)\s*)?(.*)$/i

// The inspector URL is worth keeping -- people copy it into a debugger -- but
// the "For help, see:" line that follows it is boilerplate.
const INSPECTOR_URL = /^Debugger listening on (ws:\/\/\S+)$/

// Lines the user can do nothing about and that say nothing about their app.
const DROP = [
    /^\(Use `node --trace-warnings/,
    /^Reparsing as ES module because module syntax was detected/,
    /^To eliminate this warning, add "type": "module"/,
    /^For help, see: https:\/\/nodejs\.org\/en\/docs\/inspector/,
    /^Debugger attached\.$/,
    /^Waiting for the debugger to disconnect/,
]

// A crashing server dumps a raw stack: the Error line, indented `at ...`
// frames, and an object literal of errno/syscall/address fields. The first
// line is the diagnosis; the rest is noise unless someone is debugging Node
// itself.
const STACK_FRAME = /^\s+at\s/
const ERROR_LINE = /^(?:Uncaught\s+)?(?:[A-Z]\w*)?Error:\s*(.+)$/
const ERROR_DETAIL_FIELD = /^\s*(code|errno|syscall|address|port|stack):\s/
const ERROR_OBJECT_EDGE = /^\s*[{}]\s*\w*$/
const CAUGHT_EXCEPTION = /^(?:Caught exception|Exception origin)/
const UNHANDLED_REJECTION = /^unhandledRejection in Catalyst\s*(.*)$/

// The house-style diagnostic the server itself renders: "  error <scope>",
// then indented detail. Recognised so it is forwarded verbatim.
const DIAGNOSTIC_LINE = /^\s{2}(error|hint|docs|log|at)\b/

// Colour codes sit in front of the text, so every pattern below must match
// against the uncoloured form or it silently stops matching the moment the
// child starts emitting colour.
const uncolour = (line) => line.replace(ANSI, "")

/**
 * Turn one raw line from the dev server into what should be shown.
 *
 * @param {string} line
 * @param {{seenWarnings: Set<string>, lastError?: string}} state
 * @returns {string|null} the line to print, or null to swallow it
 */
function formatDevLine(line, state) {
    const plain = uncolour(line)
    const trimmed = plain.trimEnd()
    // Blank lines are layout inside a diagnostic block; elsewhere they are
    // just gaps between unrelated chatter.
    if (!trimmed.trim()) return state.sawDiagnostic ? "" : null

    // Lines the server already rendered as a diagnostic are in the house
    // style: pass them through untouched rather than re-parsing them as raw
    // error output and swallowing them.
    if (DIAGNOSTIC_LINE.test(plain)) {
        state.sawDiagnostic = true
        return line
    }
    if (state.sawDiagnostic && /^\s{2,}/.test(plain)) return line

    if (DROP.some((pattern) => pattern.test(trimmed))) return null
    if (WARNING_FOOTER.test(trimmed)) return null

    // Swallow the machinery around a crash; the command reports it once, as a
    // diagnostic, using the message captured below. After the banner there is
    // no such report -- the process keeps running -- so the frames are the only
    // thing saying *where* a live crash happened.
    if (STACK_FRAME.test(trimmed)) return state.flushed ? `${GUTTER}${t.dim(trimmed.trim())}` : null
    if (ERROR_DETAIL_FIELD.test(trimmed)) return null
    if (ERROR_OBJECT_EDGE.test(trimmed)) return null
    if (CAUGHT_EXCEPTION.test(trimmed)) return null

    // The server logs this once and stays alive, so there is no exit handler
    // to report it later -- swallowing it lost the failure entirely.
    const rejection = UNHANDLED_REJECTION.exec(trimmed)
    if (rejection) {
        const detail = rejection[1] && rejection[1] !== "{}" ? ` ${rejection[1]}` : ""
        state.lastError = `Unhandled promise rejection${detail}`
        // Same rule as a raw Error line: before the banner the exit handler
        // renders it once, so printing here would duplicate it.
        if (!state.flushed) return null
        return `${GUTTER}${t.bad(glyph.fail)} Unhandled promise rejection${t.dim(detail)}`
    }
    // A bare number is what `console.log(process.stderr.fd)` in the server's
    // uncaughtException handler emits.
    if (/^\d+$/.test(trimmed)) return null

    const error = ERROR_LINE.exec(trimmed)
    if (error) {
        state.lastError = error[1]
        // Before the server is up, stay quiet: a failed start ends in the exit
        // handler, which renders one proper diagnostic. Afterwards the process
        // keeps running and that handler never fires, so swallowing the line
        // would lose the only report of a live error.
        if (!state.flushed) return null
        return `${GUTTER}${t.bad(glyph.fail)} ${error[1]}`
    }

    const inspector = INSPECTOR_URL.exec(trimmed)
    if (inspector) {
        return `${GUTTER}${t.dim("Inspect".padEnd(9))}${t.accent(inspector[1])}`
    }

    const warning = WARNING_START.exec(trimmed)
    if (warning) {
        const [, code, message] = warning
        // The same warning often fires once per worker; show it once.
        const key = code || message
        if (state.seenWarnings.has(key)) return null
        state.seenWarnings.add(key)

        return `${GUTTER}${t.warn(glyph.warn)} ${t.dim(summariseNodeWarning(code, message))}`
    }

    const notice = VITE_NOTICE.exec(trimmed)
    if (notice) {
        const [, channel, message] = notice
        // The channel (client/ssr) is the useful half of the prefix -- it says
        // which bundle is being rebuilt -- so keep it, dimmed, as a label.
        const scope = channel ? `${t.dim(`${channel} `)}` : ""
        return `${GUTTER}${t.dim(glyph.info)} ${scope}${t.dim(message)}`
    }

    return `${GUTTER}${t.dim(glyph.info)} ${t.dim(trimmed)}`
}

/**
 * One actionable sentence for the process warnings we recognise.
 * Anything unrecognised keeps Node's own wording.
 */
function summariseNodeWarning(code, message) {
    if (code === "MODULE_TYPELESS_PACKAGE_JSON") {
        return `Add "type": "module" to package.json to silence a Node reparse warning`
    }
    return message
}

/**
 * A line-splitting wrapper: feeds whole lines to `onLine`, holding back a
 * trailing partial until its newline arrives.
 */
function createLineReader(onLine) {
    let partial = ""
    return {
        push(chunk) {
            const lines = (partial + chunk.toString()).split("\n")
            partial = lines.pop()
            for (const line of lines) onLine(line)
        },
        flush() {
            if (partial) {
                onLine(partial)
                partial = ""
            }
        },
    }
}

/**
 * Wire a spawned dev/production server's output into the house style.
 *
 * Shared by `start` and `serve` rather than copied: they present the same
 * screen and both need the banner fences consumed, the startup chatter held
 * back until the banner has landed, and Node's multi-line warnings collapsed.
 *
 * @param {import('child_process').ChildProcess} child
 * @returns {{state: object, flushRemaining: () => void}}
 */
function wireServerOutput(child) {
    const state = { seenWarnings: new Set() }

    // Startup chatter is held back and replayed under the banner. The URL is
    // what someone is waiting for, so it should not be pushed down the screen
    // by notices about lockfiles and package.json fields.
    const pending = []
    let flushed = false
    let flushScheduled = false
    let inBanner = false

    // Held back until after the notices so the actionable line lands last.
    let nextStep = null

    const flushPending = () => {
        flushed = true
        state.flushed = true
        if (pending.length) {
            console.log(`\n${GUTTER}${t.dim("Notices")}`)
            for (const line of pending) console.log(line)
            pending.length = 0
        }
        if (nextStep) {
            console.log(`\n${nextStep}`)
            nextStep = null
        }
    }

    const route = (line) => {
        // The next-step line arrives inside the banner but must print after the
        // notices, so it is held rather than forwarded in place.
        const nextAt = line.indexOf(NEXT_STEP)
        if (nextAt !== -1) {
            nextStep = line.slice(nextAt + NEXT_STEP.length)
            return
        }
        // Fenced banner: forward verbatim, fences themselves never shown.
        if (line.includes(BANNER_START)) {
            inBanner = true
            return
        }
        if (line.includes(BANNER_END)) {
            inBanner = false
            // Give late-arriving startup notices a moment to land so they join
            // the same group rather than trailing in one at a time after it.
            if (!flushScheduled) {
                flushScheduled = true
                setTimeout(flushPending, 250).unref?.()
            }
            return
        }
        if (inBanner) {
            console.log(line)
            return
        }

        const formatted = formatDevLine(line, state)
        if (formatted === null) return

        // Before the banner, hold everything back. After it, print as it
        // happens -- an HMR update or a request error is a live event.
        if (flushed) console.log(formatted)
        else pending.push(formatted)
    }

    const stdout = createLineReader(route)
    const stderr = createLineReader(route)
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))

    return {
        state,
        // On a failed start the banner never arrives, so anything held back is
        // still queued -- including the server's own diagnostic.
        flushRemaining() {
            stdout.flush()
            stderr.flush()
            for (const line of pending) console.log(line)
            pending.length = 0
            nextStep = null
        },
    }
}

/**
 * Supervise a spawned server: wire its output, forward signals, and report its
 * exit exactly once.
 *
 * Shared by `start` and `serve` rather than copied. The two differ only in what
 * they call the thing that failed, and when the silent-crash bug was fixed the
 * same block had to be edited identically in both files -- which is the
 * argument for it living in one place.
 *
 * @param {import("child_process").ChildProcess} child
 * @param {object} options
 * @param {string} options.scope - names the failing part, e.g. "dev server"
 * @param {string} options.label - what could not be started, for the spawn error
 */
function superviseServer(child, { scope, label }) {
    const { diagnostic } = require("./diagnostic.js")
    const { hintFor } = require("./hints.js")

    const { state, flushRemaining } = wireServerOutput(child)

    // Ctrl-C reaches the child through the shared process group; forward the
    // rest so a `kill` of this wrapper takes the server with it.
    for (const signal of ["SIGTERM", "SIGHUP"]) {
        process.on(signal, () => child.kill(signal))
    }

    child.on("error", (error) => {
        process.stderr.write(diagnostic({ message: `Could not start the ${label}: ${error.message}` }))
        process.exit(1)
    })

    child.on("close", (code, signal) => {
        flushRemaining()

        // Ctrl-C is the normal way to stop a server, not a failure.
        if (signal === "SIGINT" || signal === "SIGTERM") process.exit(0)

        if (code !== 0) {
            // Report unless the server already printed its own diagnostic.
            // Gating this on a matching hint meant an unrecognised crash
            // exited silently -- the case where the user most needs telling.
            if (!state.sawDiagnostic) {
                const known = hintFor(state.lastError || "")
                process.stderr.write(
                    diagnostic({
                        message: state.lastError || `The server exited unexpectedly (code ${code})`,
                        scope,
                        hint: known?.hint,
                        docs: known?.docs,
                    })
                )
            }
            process.exit(code ?? 1)
        }
        process.exit(0)
    })

    return state
}

module.exports = {
    formatDevLine,
    createLineReader,
    wireServerOutput,
    superviseServer,
    BANNER_START,
    BANNER_END,
    NEXT_STEP,
}
