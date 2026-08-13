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
    const label = [code, scope].filter(Boolean).join(" ")
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

    if (docs) out.push(`${GUTTER}${t.dim("docs")}  ${t.dim(docs)}`)

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
            hint: error?.suggestedAction || known?.hint,
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

module.exports = { diagnostic, buildFailure }
