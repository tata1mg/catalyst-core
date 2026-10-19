"use strict"

const { GUTTER, glyph, t, ANSI, isVerbose } = require("./theme.js")

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

// How long an error-like startup line may wait for the banner before it is
// printed anyway.
const EARLY_FLUSH_MS = 500

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

// Vite bookkeeping that is true but not news: the dependency pre-bundler
// re-running, and catalyst's optimizeDeps list naming optional packages this
// app does not use. --verbose keeps them.
const VERBOSE_ONLY = [
    /^Re-optimizing dependencies because/i,
    /^new dependencies optimized:/i,
    /^optimized dependencies changed\. reloading/i,
    /^Forced re-optimization of dependencies/i,
    /^Failed to resolve dependency: .+ present in .*'optimizeDeps\.include'/i,
    /^\[catalyst-core\/ai\] catalyst-ai not installed/,
]

// Vite's reload notices, reworded: what changed is the news, not the channel.
const VITE_RELOAD = /^(page reload|hmr update)\s+(.+?)(\s+\(x\d+\))?$/i

// React Router's warning for an unknown URL, shortened to what it means.
const NO_ROUTE = /^No routes matched location "([^"]*)"/

// Two dev servers cannot share Vite's HMR socket; the second one still serves
// pages but never live-reloads, which is worth one clear line.
const HMR_PORT_TAKEN = /^WebSocket server error: Port (\d+) is already in use/

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
    const verbose = state.verbose ?? isVerbose()
    const unprefixed = VITE_NOTICE.exec(trimmed)?.[2] ?? trimmed

    // Vite logs a failed SSR module evaluation itself -- message, plugin,
    // file, frame and its own stack -- and then the request handler reports
    // the same error with the app's file and source. Keep the one report.
    // Checked first: Vite indents the block, which would otherwise pass as
    // part of an earlier diagnostic.
    if (!verbose && /^Error when evaluating SSR module/.test(unprefixed.trim())) {
        state.inViteError = true
        state.viteErrorLines = 0
        return null
    }
    if (state.inViteError) {
        // Ends at our own report, at Vite's next notice, or -- so a report that
        // never arrives cannot swallow the session -- after a bounded run.
        state.viteErrorLines = (state.viteErrorLines || 0) + 1
        const ends = DIAGNOSTIC_LINE.test(plain) || VITE_NOTICE.test(trimmed) || state.viteErrorLines > 60
        if (!ends) return null
        state.inViteError = false
        // The blank line that opens our report was swallowed with Vite's block.
        state.pendingBlank = true
    }

    // Blank lines are layout inside a diagnostic block; elsewhere they are
    // just gaps between unrelated chatter -- except the one that opens a
    // diagnostic, which is remembered and kept if a block follows.
    if (!trimmed.trim()) {
        if (state.sawDiagnostic) return ""
        state.pendingBlank = true
        return null
    }
    const openedWithBlank = state.pendingBlank
    state.pendingBlank = false

    // Lines the server already rendered as a diagnostic are in the house
    // style: pass them through untouched rather than re-parsing them as raw
    // error output and swallowing them.
    if (DIAGNOSTIC_LINE.test(plain)) {
        state.sawDiagnostic = true
        return openedWithBlank ? `\n${line}` : line
    }
    if (state.sawDiagnostic && /^\s{2,}/.test(plain)) return line

    if (DROP.some((pattern) => pattern.test(trimmed))) return null
    if (WARNING_FOOTER.test(trimmed)) return null

    if (!verbose && VERBOSE_ONLY.some((pattern) => pattern.test(unprefixed.trim()))) return null

    const reload = VITE_RELOAD.exec(unprefixed.trim())
    if (reload) {
        // The ssr and client channels both report the same file; one line is enough.
        const key = `${reload[2]}@${Math.floor(Date.now() / 500)}`
        if (state.lastReload === key) return null
        state.lastReload = key
        return `${GUTTER}${t.dim("↻")} ${t.dim(reload[2])}${t.dim(reload[3] || "")}`
    }

    const noRoute = NO_ROUTE.exec(trimmed)
    if (noRoute) return `${GUTTER}${t.warn(glyph.warn)} ${t.dim(`No route matches ${noRoute[1]}`)}`

    const hmrTaken = HMR_PORT_TAKEN.exec(trimmed)
    if (hmrTaken) {
        return `${GUTTER}${t.warn(glyph.warn)} ${t.dim(`Live reload is off: port ${hmrTaken[1]} is used by another dev server`)}`
    }

    // Swallow the machinery around a crash; the command reports it once, as a
    // diagnostic, using the message captured below. After the banner there is
    // no such report -- the process keeps running -- so the frames are the only
    // thing saying *where* a live crash happened. Before it, --verbose keeps
    // them: a non-fatal startup error has no other way to say where it came from.
    if (STACK_FRAME.test(trimmed)) {
        return state.flushed || verbose ? `${GUTTER}${t.dim(trimmed.trim())}` : null
    }
    if (ERROR_DETAIL_FIELD.test(trimmed)) return null
    if (ERROR_OBJECT_EDGE.test(trimmed)) return null
    if (CAUGHT_EXCEPTION.test(trimmed)) return null

    // The server logs this once and stays alive, so there is no exit handler
    // to report it later -- swallowing it lost the failure entirely.
    const rejection = UNHANDLED_REJECTION.exec(trimmed)
    if (rejection) {
        const detail = rejection[1] && rejection[1] !== "{}" ? ` ${rejection[1]}` : ""
        state.lastError = `Unhandled promise rejection${detail}`
        // Same rule as a raw Error line below.
        state.lastErrorLine = `${GUTTER}${t.bad(glyph.fail)} Unhandled promise rejection${t.dim(detail)}`
        return state.lastErrorLine
    }
    // A bare number is what `console.log(process.stderr.fd)` in the server's
    // uncaughtException handler emits.
    if (/^\d+$/.test(trimmed)) return null

    const error = ERROR_LINE.exec(trimmed)
    if (error) {
        state.lastError = error[1]
        // Always shown: a `console.error(err)` the server survives -- a cache or
        // API down at startup -- has no other report. When the error instead
        // ends a failed start, the exit handler renders it as the diagnostic and
        // drops this line (see lastErrorLine) so it is not said twice.
        state.lastErrorLine = `${GUTTER}${t.bad(glyph.fail)} ${error[1]}`
        return state.lastErrorLine
    }

    const inspector = INSPECTOR_URL.exec(trimmed)
    if (inspector) {
        return `${GUTTER}${t.dim("Inspect".padEnd(9))}${t.accent(inspector[1])}`
    }

    const warning = WARNING_START.exec(trimmed)
    if (warning) {
        const [, code, message] = warning
        // Node reparsing an app file as ESM costs a few ms at startup and
        // nothing else; it is not worth a line on every start.
        if (code === "MODULE_TYPELESS_PACKAGE_JSON" && !verbose) return null
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
 * @returns {{state: object, flushRemaining: (options?: {dropLastError?: boolean}) => void}}
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

    // A startup that fails without exiting -- listen() erroring while Vite
    // keeps the process alive -- never reaches the banner, so its diagnostic
    // would sit in `pending` behind a blank screen forever. Once something
    // error-like is queued, print the queue shortly after, without waiting.
    let earlyTimer = null
    const printEarly = () => {
        earlyTimer = null
        if (flushed) return
        for (const line of pending) console.log(line)
        pending.length = 0
    }

    const flushPending = () => {
        clearTimeout(earlyTimer)
        flushed = true
        state.flushed = true
        if (pending.length) {
            console.log(`\n${GUTTER}${t.dim("Notices")}`)
            for (const line of pending) console.log(line)
            pending.length = 0
        }
        if (nextStep) {
            // Live events (reloads, request errors) follow; a gap keeps them
            // from reading as part of the banner.
            console.log(`\n${nextStep}\n`)
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
        if (flushed) {
            console.log(formatted)
            return
        }
        pending.push(formatted)
        // Short enough to read as prompt, long enough for a crash's exit to
        // win the race, so a fatal error is still reported once by the exit
        // handler rather than here as well.
        if (!earlyTimer && (state.sawDiagnostic || formatted === state.lastErrorLine)) {
            earlyTimer = setTimeout(printEarly, EARLY_FLUSH_MS)
            earlyTimer.unref?.()
        }
    }

    const stdout = createLineReader(route)
    const stderr = createLineReader(route)
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))

    return {
        state,
        // On a failed start the banner never arrives, so anything held back is
        // still queued -- including the server's own diagnostic. With
        // `dropLastError` the exit handler is about to render the last error
        // as a diagnostic, so its one-line form is left out.
        flushRemaining({ dropLastError = false } = {}) {
            clearTimeout(earlyTimer)
            stdout.flush()
            stderr.flush()
            const skip = dropLastError && !state.sawDiagnostic ? state.lastErrorLine : undefined
            for (const line of pending) if (line !== skip) console.log(line)
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
 * @param {boolean} [options.passthrough] - the child inherits stdio; its output
 *   is not wired or reworded, and only signals and the exit code are handled
 */
function superviseServer(child, { scope, label, passthrough = false }) {
    const { diagnostic } = require("./diagnostic.js")
    const { hintFor } = require("./hints.js")

    const { state, flushRemaining } = passthrough
        ? { state: {}, flushRemaining() {} }
        : wireServerOutput(child)

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
        // Ctrl-C is the normal way to stop a server, not a failure.
        const stopped = signal === "SIGINT" || signal === "SIGTERM"
        flushRemaining({ dropLastError: !stopped && code !== 0 })
        if (stopped) process.exit(0)

        if (code !== 0) {
            // Report unless the server already printed its own diagnostic.
            // Gating this on a matching hint meant an unrecognised crash
            // exited silently -- the case where the user most needs telling.
            // A passthrough child's own output already said why, unaltered.
            if (!passthrough && !state.sawDiagnostic) {
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

/**
 * Fail before spawning the server when its port is taken.
 *
 * Checked up front because the child only learns it at listen(), after Vite
 * and the app have loaded -- by which point it has also printed startup
 * notices and grabbed (or failed to grab) the HMR port, so the real problem
 * arrived buried under two unrelated lines and Node's raw EADDRINUSE text.
 */
function ensurePortFree({ port, host, scope }) {
    const net = require("net")
    const { diagnostic } = require("./diagnostic.js")
    const numeric = Number(port)
    if (!Number.isInteger(numeric) || numeric <= 0) return Promise.resolve()

    return new Promise((resolve) => {
        const probe = net.createServer()
        probe.once("error", (error) => {
            if (error.code !== "EADDRINUSE") return resolve()
            const owner = portOwner(numeric)
            process.stderr.write(
                diagnostic({
                    message: `Port ${numeric} is already in use${owner ? ` by ${owner.command} (pid ${owner.pid})` : ""}`,
                    scope,
                    hint: owner
                        ? `Stop it with \`kill ${owner.pid}\`, or change NODE_SERVER_PORT and PUBLIC_STATIC_ASSET_URL in config/config.json.`
                        : "Stop whatever is using it, or change NODE_SERVER_PORT and PUBLIC_STATIC_ASSET_URL in config/config.json.",
                })
            )
            process.exit(1)
        })
        probe.once("listening", () => probe.close(() => resolve()))
        probe.listen({ port: numeric, host: host || undefined })
    })
}

/** The process listening on a port, via lsof; null where lsof is unavailable. */
function portOwner(port) {
    try {
        const { execFileSync } = require("child_process")
        const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 3000,
        })
        const pid = /^p(\d+)$/m.exec(out)?.[1]
        const command = /^c(.+)$/m.exec(out)?.[1]
        return pid ? { pid, command: command || "another process" } : null
    } catch (error) {
        return null
    }
}

module.exports = {
    ensurePortFree,
    formatDevLine,
    createLineReader,
    wireServerOutput,
    superviseServer,
    BANNER_START,
    BANNER_END,
    NEXT_STEP,
}
