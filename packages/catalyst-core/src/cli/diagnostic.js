"use strict"

const fs = require("fs")
const path = require("path")

const { GUTTER, glyph, t } = require("./theme.js")

const CONTEXT_LINES = 2

/**
 * Render one failure the way a person reads it: what went wrong, where, the
 * code around it, and what to do about it.
 *
 * Everything except `message` is optional, so a caller with only a message
 * still gets a well-formed diagnostic rather than a half-empty template.
 *
 * @param {object} options
 * @param {string} options.message   - what went wrong, one line
 * @param {string} [options.code]    - stable error id, e.g. "BUNDLE-000". The
 *   error registry owns which code a failure carries and what it means; this
 *   layer only decides how it looks. Optional so callers without a code are
 *   unaffected.
 * @param {string} [options.scope]   - which part failed, e.g. "client bundle"
 * @param {string} [options.file]    - path to the offending file
 * @param {number} [options.line]    - 1-indexed
 * @param {number} [options.column]  - 1-indexed
 * @param {string} [options.hint]    - how to fix it
 * @param {string} [options.docs]    - a URL that explains more
 * @param {string} [options.cwd]     - root for relative paths
 */
function diagnostic(options) {
    const { message, code, scope, file, line, column, hint, docs, cwd = process.cwd() } = options

    const out = []
    out.push("")
    // The code identifies the failure; the scope says which part produced it.
    // Both are dim -- they orient, they are not the thing you read first.
    const label = [code, scope].filter(Boolean).join("  ")
    out.push(`${GUTTER}${t.bad(t.bold("error"))}${label ? ` ${t.dim(label)}` : ""}`)
    out.push(`${GUTTER}${t.bold(message)}`)

    if (file) {
        const shown = relativeIfInside(file, cwd)
        const position = line != null ? `:${line}${column != null ? `:${column}` : ""}` : ""
        out.push(`${GUTTER}${t.dim("at")} ${t.accent(shown)}${t.dim(position)}`)
    }

    const frame = file && line != null ? codeFrame(file, line, column) : null
    if (frame) {
        out.push("")
        out.push(frame)
    }

    if (hint) {
        out.push("")
        for (const [index, text] of wrap(hint, 72).entries()) {
            out.push(index === 0 ? `${GUTTER}${t.accent("hint")}  ${text}` : `${GUTTER}      ${text}`)
        }
    }

    if (docs) {
        // Under a hint the two read as a pair; under a code frame the docs line
        // needs the same gap a hint gets, or it reads as part of the source.
        if (!hint && frame) out.push("")
        out.push(`${GUTTER}${t.dim("docs")}  ${t.dim(docs)}`)
    }

    out.push("")
    return out.join("\n")
}

/**
 * The offending line with its neighbours, and a caret under the column.
 * Returns null rather than throwing when the file cannot be read -- a
 * diagnostic must never fail while reporting a failure.
 */
function codeFrame(file, line, column) {
    let source
    try {
        source = fs.readFileSync(file, "utf8")
    } catch (error) {
        return null
    }

    const lines = source.split("\n")
    if (line < 1 || line > lines.length) return null

    const first = Math.max(1, line - CONTEXT_LINES)
    const last = Math.min(lines.length, line + CONTEXT_LINES)
    const width = String(last).length + 1

    const rendered = []
    for (let n = first; n <= last; n++) {
        const text = lines[n - 1].replace(/\t/g, "    ")
        const number = String(n).padStart(width)

        if (n === line) {
            rendered.push(`${GUTTER}${t.bad(">")} ${t.dim(number)} ${t.dim(glyph.pipe)} ${text}`)
            if (column != null && column > 0) {
                const pad = " ".repeat(width)
                rendered.push(`${GUTTER}  ${pad} ${t.dim(glyph.pipe)} ${" ".repeat(column - 1)}${t.bad("^")}`)
            }
        } else {
            rendered.push(`${GUTTER}  ${t.dim(number)} ${t.dim(glyph.pipe)} ${t.dim(text)}`)
        }
    }
    return rendered.join("\n")
}

function relativeIfInside(file, cwd) {
    const relative = path.relative(cwd, file)
    return relative && !relative.startsWith("..") ? relative : file
}

function wrap(text, width) {
    const words = String(text).split(/\s+/)
    const lines = []
    let current = ""
    for (const word of words) {
        if (current && current.length + word.length + 1 > width) {
            lines.push(current)
            current = word
        } else {
            current = current ? `${current} ${word}` : word
        }
    }
    if (current) lines.push(current)
    return lines
}

/**
 * Report a failed native build by showing what the compiler actually said.
 *
 * The alternative -- and what this replaces -- is "Command failed with exit
 * code 1" plus a generic checklist, which sends people to Android Studio or
 * Xcode to find out what broke.
 *
 * @param {object} options
 * @param {Error} options.error   - the failure, ideally carrying `.output`
 * @param {string} options.stage  - what was being done, e.g. "Gradle build"
 * @param {string} [options.cwd]
 */
function buildFailure({ error, stage, cwd = process.cwd() }) {
    const { extractBuildErrors, outputTail, MAX_ERRORS } = require("./buildErrors.js")
    const { hintFor } = require("./hints.js")

    // A wrapped registry error keeps the toolchain failure as `cause`, and the
    // captured transcript rides on whichever of the two actually ran the child.
    const output = error?.output || error?.cause?.output || ""
    const found = extractBuildErrors(output)
    const code = error?.code && typeof error.code === "string" ? error.code : null

    if (found.length > 0) {
        const out = []
        const label = found.length === 1 ? "error" : `${found.length} errors`
        const scopeLabel = [code, stage].filter(Boolean).join(" ")
        out.push(`\n${GUTTER}${t.bad(t.bold(label))} ${t.dim(scopeLabel)}\n`)

        for (const item of found) {
            out.push(`${GUTTER}${t.bold(item.message)}\n`)
            if (item.file) {
                const shown = relativeIfInside(item.file.replace(/^file:\/\//, ""), cwd)
                const at =
                    item.line != null ? `:${item.line}${item.column != null ? `:${item.column}` : ""}` : ""
                out.push(`${GUTTER}${t.dim("at")} ${t.accent(shown)}${t.dim(at)}\n`)

                const frame = codeFrame(item.file.replace(/^file:\/\//, ""), item.line, item.column)
                if (frame) out.push(`\n${frame}\n`)
            }
            out.push("\n")
        }

        // Advice authored against a code we own beats a pattern guess. The
        // per-stage wrapper codes (BUNDLE-000 and friends) are the exception:
        // their suggestedAction only says to read the upstream error, which is
        // the text we just extracted, so the mined hint stays.
        const authored = code && !/-000$/.test(code) ? error?.suggestedAction : null
        const first = authored ? { hint: authored, docs: error?.docUrl } : hintFor(found[0].message)
        if (first) {
            out.push(`${GUTTER}${t.accent("hint")}  ${first.hint}\n\n`)
        }
        if (found.length === MAX_ERRORS) {
            out.push(`${GUTTER}${t.dim("… more errors may follow; the full build output is above.")}\n\n`)
        }
        return out.join("")
    }

    // Nothing recognised: show the tail rather than claiming to know better.
    const tail = outputTail(output)
    const known = hintFor(error?.message || "")
    const bareExit = /^Command failed with exit code \d+$/.test(String(error?.message || "").trim())
    return (
        diagnostic({
            // "Command failed with exit code 1" names the symptom, not the
            // failure. When that is all the child gave us, say where it broke
            // and let the output below carry the detail.
            message: bareExit ? `${stage || "The build"} failed` : error?.message || "The build failed",
            code,
            // Already named in the message above; repeating it reads as a stutter.
            scope: bareExit ? undefined : stage,
            hint: error?.hint || error?.suggestedAction || known?.hint,
            docs: error?.docUrl || known?.docs,
            cwd,
        }) +
        (tail
            ? `\n${GUTTER}${t.dim("Last output from the build:")}\n` +
              tail
                  .split("\n")
                  .map((line) => `${GUTTER}${t.dim(glyph.pipe)} ${t.dim(line)}`)
                  .join("\n") +
              "\n\n"
            : "")
    )
}

// V8 frame: "    at fn (file:line:col)" or "    at file:line:col".
const FRAME = /^\s*at\s+(?:(.*?)\s+\()?(?:file:\/\/)?([^()]+?):(\d+):(\d+)\)?\s*$/

/** Parse a V8 stack into frames; lines that are not frames are skipped. */
function parseFrames(stack) {
    const frames = []
    for (const line of String(stack || "").split("\n")) {
        const match = FRAME.exec(line)
        if (!match) continue
        const [, fn, file, lineNo, column] = match
        frames.push({ fn: fn || null, file, line: Number(lineNo), column: Number(column) })
    }
    return frames
}

/**
 * A frame in the user's own code: inside the app, outside node_modules and
 * Node's internals. These are the only frames someone can act on -- a React
 * render error otherwise arrives under ten frames of react-dom.
 */
function isAppFrame(frame, cwd) {
    if (!frame.file || frame.file.startsWith("node:")) return false
    if (frame.file.includes(`${path.sep}node_modules${path.sep}`)) return false
    const relative = path.relative(cwd, frame.file)
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function describeFrame(frame, cwd) {
    const where = `${relativeIfInside(frame.file, cwd)}:${frame.line}:${frame.column}`
    return frame.fn ? `${frame.fn} ${t.dim(`(${where})`)}` : where
}

/**
 * Report an error raised while the server is running -- a render that threw, a
 * data fetcher that rejected, an uncaught exception.
 *
 * One block per failure, pointed at the first frame in the app's own code with
 * the source around it. The default view omits library frames entirely;
 * `verbose` lists the app's frames, `debug` prints the whole stack and the
 * environment.
 *
 * @param {object} options
 * @param {*}      options.error    - whatever was thrown
 * @param {string} [options.code]   - registry code, e.g. "RUNTIME-WEB-001"
 * @param {string} [options.scope]  - where it happened, e.g. "GET /products"
 * @param {string} [options.docs]
 * @param {string} [options.mode]   - "default" | "verbose" | "debug"
 * @param {object} [options.env]    - debug-mode environment, key -> value
 * @param {string} [options.cwd]    - the app root
 */
function runtimeFailure({ error, code, scope, docs, mode = "default", env, cwd = process.cwd() }) {
    const isError = error instanceof Error || (error && typeof error === "object" && "message" in error)
    let message = isError ? String(error.message || error.name || "Error") : String(error)
    // Bundler messages run to several sentences of generic advice; the first
    // says what happened, and the location below says where.
    if (message.length > 100) message = message.replace(/^(.+?\.)\s+[A-Z].*$/s, "$1")
    const frames = isError ? parseFrames(error.stack) : []
    const appFrames = frames.filter((frame) => isAppFrame(frame, cwd))
    // A transform error (Vite) carries the source position as `loc`, its
    // column already 1-based; its stack is the bundler's own and says nothing
    // about the app.
    const loc = isError && error.loc?.file ? error.loc : null
    const origin = loc ? { file: loc.file, line: loc.line, column: loc.column } : appFrames[0]
    const { hintFor } = require("./hints.js")
    const known = hintFor(message)

    let out = diagnostic({
        message: isError && error.name && error.name !== "Error" ? `${error.name}: ${message}` : message,
        code,
        scope,
        file: origin?.file,
        line: origin?.line,
        column: origin?.column,
        hint: known?.hint,
        docs: docs || known?.docs,
        cwd,
    })

    if (mode === "verbose" && appFrames.length > 1) {
        out += `${GUTTER}${t.dim("stack")}\n`
        out += appFrames.map((frame) => `${GUTTER}  ${t.dim("at")} ${describeFrame(frame, cwd)}`).join("\n")
        out += "\n\n"
    }
    if (mode === "debug") {
        const stack = isError && error.stack ? String(error.stack).split("\n").slice(1) : []
        if (stack.length) out += `${stack.map((line) => `${GUTTER}${t.dim(line.trim())}`).join("\n")}\n\n`
        if (env) {
            out += Object.entries(env)
                .map(([key, value]) => `${GUTTER}${t.dim(key.padEnd(10))}${value}`)
                .join("\n")
            out += "\n\n"
        }
    }
    return out
}

/**
 * The --verbose/--debug addendum for a failed build: the registry code and
 * docs, then everything the tool printed. The default view shows only the
 * extracted errors; when someone asks for more, the useful "more" is the raw
 * output, not a restatement of the exit code.
 */
function verboseOutput({ code, docs, output, mode = "verbose", error, env }) {
    // Leads with a blank line: it follows a diagnostic block directly.
    const out = [""]
    const label = [code, docs].filter(Boolean).map((part) => t.dim(part))
    if (label.length) out.push(`${GUTTER}${label.join(t.dim("  ·  "))}`)
    const text = String(output || "").replace(/\s+$/, "")
    if (text) {
        out.push(`${GUTTER}${t.dim("Full output:")}`)
        for (const line of text.split("\n")) out.push(`${GUTTER}${t.dim(glyph.pipe)} ${line}`)
    }
    if (mode === "debug") {
        const stack = error?.stack ? String(error.stack).split("\n").slice(1) : []
        if (stack.length) out.push("", ...stack.map((line) => `${GUTTER}${t.dim(line.trim())}`))
        if (env) {
            out.push(
                "",
                ...Object.entries(env).map(([key, value]) => `${GUTTER}${t.dim(key.padEnd(10))}${value}`)
            )
        }
    }
    return out.length > 1 ? `${out.join("\n")}\n\n` : ""
}

module.exports = {
    diagnostic,
    buildFailure,
    runtimeFailure,
    verboseOutput,
    codeFrame,
    parseFrames,
    isAppFrame,
}
