// Plain ESM imports of a CommonJS module: this file is authored as ESM but
// babel-compiled to CJS by `npm run prepare` (src/native/package.json pins
// "type": "commonjs"), so these become require() calls and the interop is
// babel's. import.meta is unavailable after that transform, hence no
// createRequire here.
import theme from "../cli/theme.js"
import spinnerModule from "../cli/spinner.js"

const { GUTTER, glyph, t, header, duration, isInteractive, isVerbose, step: stepLine } = theme
const { Spinner } = spinnerModule

/**
 * Step-by-step progress for the native builds.
 *
 * Append-only by design. An earlier version redrew the whole step tree in
 * place on every change, which meant the renderer had to own a multi-line
 * region of the screen -- and every interleaving with child output (gradle,
 * xcodebuild) became a cursor-math bug. Here each step settles into a single
 * permanent line as it finishes, and the only live thing is a one-line spinner
 * that owns nothing but its own row. Streamed output can therefore appear
 * between steps with nothing to corrupt.
 *
 * The public API (start/complete/fail/log/pause/resume/printTreeContent) is
 * unchanged, because the native build code calls it from ~400 places.
 */
class TerminalProgress {
    /**
     * @param {object} steps          - id -> description
     * @param {string} title          - the invocation, e.g. "catalyst buildApp"
     * @param {object} [options]
     * @param {string} [options.subject] - the target, e.g. "android"
     */
    constructor(steps, title = "Setup Progress", options = {}) {
        this.steps = new Map(
            Object.entries(steps).map(([id, description]) => [
                id,
                { id, description, status: "pending", error: null, startedAt: 0 },
            ])
        )
        this.title = title
        this.subject = options.subject
        this.startedAt = Date.now()
        this.currentStep = null
        this.isInteractive = options.isInteractive ?? isInteractive()
        this.spinner = new Spinner(process.stdout)
        this.headerPrinted = false
        this.pauseDepth = 0
        // The native build narrates every internal decision ("Package.swift
        // already up to date", "Copied 0 plugin files"). Useful when debugging
        // the build itself, noise otherwise -- so by default those notes ride on
        // the spinner's row and vanish, and --verbose prints them as lines.
        this.verbose = options.verbose ?? isVerbose()
    }

    ensureHeader() {
        if (this.headerPrinted) return
        this.headerPrinted = true
        process.stdout.write(header(this.title, this.subject))
    }

    start(id) {
        const step = this.steps.get(id)
        if (!step) throw new Error(`Step ${id} not found`)

        this.ensureHeader()
        this.currentStep = step
        step.status = "running"
        step.startedAt = Date.now()
        this.spinner.start(step.description)
    }

    complete(id) {
        const step = this.steps.get(id)
        if (!step) throw new Error(`Step ${id} not found`)

        step.status = "completed"
        this.settle(step, "done")
    }

    fail(id, error) {
        const step = this.steps.get(id)
        if (!step) throw new Error(`Step ${id} not found`)

        step.status = "error"
        step.error = error
        this.settle(step, "fail")

        // A bare exit-code message says nothing the ✗ line has not already
        // said, and the diagnostic that follows repeats it verbatim as its
        // headline. Only print detail that adds something.
        if (error && !/^Command failed with exit code \d+$/.test(String(error).trim())) {
            console.log(`${GUTTER}${t.dim(glyph.last)} ${t.bad(error)}`)
        }
    }

    settle(step, state) {
        this.ensureHeader()
        if (this.currentStep === step) this.currentStep = null

        if (this.spinner.active) {
            this.spinner.stop(state, step.description)
        } else {
            console.log(
                stepLine(step.description, step.startedAt ? Date.now() - step.startedAt : null, state)
            )
        }
    }

    /**
     * A note that belongs with the current step rather than being a step.
     *
     * Warnings, errors, prompts and `note` always print, beneath the running
     * line and marked as subordinate. `info` and `success` are narration: by
     * default they replace the spinner's detail text and leave no line behind,
     * and only --verbose keeps them. Use `note` for the rare line a user must
     * act on or keep (a manual launch step, where a keystore was written).
     */
    log(message, type = "info") {
        if (!this.verbose && (type === "info" || type === "success")) {
            if (message && this.currentStep) this.status(String(message).trim())
            return
        }

        this.ensureHeader()

        const mark =
            type === "success"
                ? t.ok(glyph.done)
                : type === "error"
                  ? t.bad(glyph.fail)
                  : type === "warning"
                    ? t.warn(glyph.warn)
                    : type === "prompt"
                      ? t.warn("?")
                      : type === "note"
                        ? t.accent(glyph.arrow)
                        : t.dim(glyph.info)

        // Stand the spinner down for exactly one line, then bring it back, so
        // the message lands above the live row instead of fighting it.
        const wasSpinning = this.spinner.active
        if (wasSpinning) this.spinner.pause()

        console.log(`${GUTTER}${t.dim(glyph.pipe)} ${mark} ${message}`)

        if (wasSpinning) this.spinner.resume()
    }

    /** The one action that fixes a failure, under the ✗ line. */
    hint(text) {
        if (!text) return
        this.ensureHeader()
        if (this.spinner.active) this.spinner.pause()
        console.log(`\n${GUTTER}${t.accent("hint")}  ${text}\n`)
    }

    /**
     * Stand the renderer down so a child process can write to the terminal.
     * Nestable: only the outermost resume restarts the animation.
     */
    pause() {
        this.pauseDepth++
        if (this.pauseDepth > 1) return
        this.spinner.pause()
    }

    resume() {
        if (this.pauseDepth === 0) return
        this.pauseDepth--
        if (this.pauseDepth > 0) return
        this.spinner.resume()
    }

    /**
     * Show what the running step is doing right now, on the spinner's own row.
     *
     * This replaces streaming a child's output: the row is rewritten, never
     * appended to, so a build that emits hundreds of lines costs one line of
     * screen. Ignored when there is no live spinner, and a null detail leaves
     * the label alone.
     */
    status(detail) {
        if (!detail || !this.currentStep) return
        this.spinner.update(`${this.currentStep.description}  ${t.dim(detail)}`)
    }

    /**
     * The closing line every command ends on: what happened, how long it took,
     * and the one command to run next.
     */
    summary(result, nextStep) {
        this.ensureHeader()
        const elapsed = duration(Date.now() - this.startedAt)
        console.log(`${GUTTER}${t.ok(glyph.done)} ${t.bold(`${result} in ${elapsed}`)}`)
        if (nextStep) {
            // Name exactly one command in the accent. Colour each fragment
            // separately -- wrapping dim() around text that already contains a
            // reset would end the dim early and leave the tail uncoloured.
            const parts = nextStep.split(/(catalyst [\w:]+)/)
            const line = parts.map((part, index) => (index % 2 === 1 ? t.accent(part) : t.dim(part))).join("")
            console.log(`${GUTTER}  ${line}`)
        }
        console.log("")
    }

    /** A titled block of key/value detail, used for build summaries. */
    printTreeContent(title, content) {
        this.ensureHeader()
        // A block is a settled thing; the spinner must be off its row first, or
        // the live line eats the blank separator above the title.
        this.spinner.stop()
        console.log(`\n${GUTTER}${t.bold(title)}`)

        for (const [index, line] of content.entries()) {
            const isLast = index === content.length - 1

            if (typeof line === "string") {
                // A bare string is a section label rather than a leaf.
                console.log(line.startsWith("\n") ? `${GUTTER}${t.dim(line.trim())}` : `${GUTTER}${line}`)
                continue
            }

            const { text, color = "white" } = line
            const paint = color === "white" ? (s) => s : t[colorAlias(color)] || ((s) => s)
            console.log(`${GUTTER}${t.dim(isLast ? glyph.last : glyph.branch)} ${paint(text)}`)
        }
        console.log("")
    }
}

/** Map the legacy colour names used across the native build to the theme. */
function colorAlias(name) {
    switch (name) {
        case "green":
            return "ok"
        case "red":
            return "bad"
        case "yellow":
            return "warn"
        case "cyan":
            return "accent"
        default:
            return "dim"
    }
}

export default TerminalProgress
